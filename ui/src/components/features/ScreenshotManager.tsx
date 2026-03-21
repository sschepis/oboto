import React, { useEffect } from 'react';
import html2canvas from 'html2canvas';
import { wsService } from '../../services/wsService';

// ─── Scoped monkey-patch for html2canvas gradient rendering ────────────────
// html2canvas can compute NaN stop offsets when rendering gradients on
// zero-dimension elements or with CSS values it can't parse.  This causes
// "Failed to execute 'addColorStop' on 'CanvasGradient': The provided double
// value is non-finite."  We patch addColorStop to silently clamp non-finite
// offsets rather than throwing — but ONLY during captures.
//
// Uses a reference counter so concurrent captures are safe — the patch stays
// installed until the last capture completes.
const _origAddColorStop = CanvasGradient.prototype.addColorStop;
let _patchRefCount = 0;

function installGradientPatch() {
    if (_patchRefCount++ === 0) {
        CanvasGradient.prototype.addColorStop = function (offset: number, color: string) {
            if (!Number.isFinite(offset)) {
                console.debug('[ScreenshotManager] Clamped non-finite gradient offset:', offset);
                offset = offset < 0 || Object.is(offset, -Infinity) ? 0 : 1;
            }
            offset = Math.max(0, Math.min(1, offset));
            try {
                _origAddColorStop.call(this, offset, color);
            } catch (e) {
                console.debug('[ScreenshotManager] Skipped unparseable color stop:', color, e);
            }
        };
    }
}

function uninstallGradientPatch() {
    if (--_patchRefCount <= 0) {
        _patchRefCount = 0;
        CanvasGradient.prototype.addColorStop = _origAddColorStop;
    }
}

/**
 * CSS Color Level 4 function names that html2canvas v1.x cannot parse.
 * When encountered (in style text or computed values), they must be
 * replaced with a safe fallback before html2canvas processes the DOM.
 */
const UNSUPPORTED_FN_NAMES = ['color', 'oklch', 'oklab', 'lab', 'lch', 'color-mix'];

/** Quick test regex — used only to check *if* sanitization is needed. */
const UNSUPPORTED_COLOR_RE = /\b(color|oklch|oklab|lab|lch|color-mix)\s*\(/i;

/** Color-related CSS properties that html2canvas tries to parse */
const COLOR_PROPS = [
    'color', 'background-color', 'background', 'background-image',
    'border-color',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow',
    'caret-color', 'column-rule-color', 'fill', 'stroke',
    'accent-color',
    // Gradient shorthand — html2canvas parses these for gradient color stops
    'border-image', 'border-image-source',
    'mask-image', '-webkit-mask-image',
    'list-style-image',
    // Additional properties that can hold color values
    'scrollbar-color', 'stop-color', 'flood-color', 'lighting-color',
    'text-emphasis-color',
    '-webkit-text-fill-color', '-webkit-text-stroke-color',
];

// ─── CSSOM-level sanitizer ────────────────────────────────────────────────

/**
 * Recursively walk a CSSRule and sanitize any property value that contains
 * an unsupported color function.  This modifies the CSSOM objects in-place,
 * which is what html2canvas reads — unlike textContent replacement, this is
 * guaranteed to affect what html2canvas's color parser encounters.
 */
function sanitizeCSSRule(rule: CSSRule) {
    // Regular style rules (selectors with declarations)
    if (rule instanceof CSSStyleRule) {
        sanitizeCSSStyleDeclaration(rule.style);
    }
    // Grouping rules (@media, @supports, @layer, etc.)
    else if ('cssRules' in rule) {
        const groupRule = rule as CSSGroupingRule;
        try {
            for (let i = 0; i < groupRule.cssRules.length; i++) {
                sanitizeCSSRule(groupRule.cssRules[i]);
            }
        } catch { /* security / cross-origin errors — skip */ }
    }
    // @keyframes rules
    else if (rule instanceof CSSKeyframesRule) {
        for (let i = 0; i < rule.cssRules.length; i++) {
            const keyframeRule = rule.cssRules[i];
            if (keyframeRule instanceof CSSKeyframeRule) {
                sanitizeCSSStyleDeclaration(keyframeRule.style);
            }
        }
    }
    // @font-face, @page — can also contain color properties
    else if ('style' in rule && (rule as any).style instanceof CSSStyleDeclaration) {
        sanitizeCSSStyleDeclaration((rule as any).style);
    }
}

/**
 * Sanitize every property in a CSSStyleDeclaration that contains an
 * unsupported color function.  Handles both named properties and custom
 * properties (--*).
 */
function sanitizeCSSStyleDeclaration(style: CSSStyleDeclaration) {
    for (let i = 0; i < style.length; i++) {
        const propName = style[i];
        const val = style.getPropertyValue(propName);
        if (val && UNSUPPORTED_COLOR_RE.test(val)) {
            const priority = style.getPropertyPriority(propName);
            if (propName.startsWith('--')) {
                // Custom property — replace unsupported functions within the value
                style.setProperty(propName, replaceUnsupportedColorFunctions(val), priority);
            } else {
                // Standard property — replace unsupported functions
                const fallback = propName === 'color' || propName === 'caret-color'
                    ? 'inherit'
                    : replaceUnsupportedColorFunctions(val);
                style.setProperty(propName, fallback, priority);
            }
        }
    }
}

/**
 * Walk ALL stylesheets in the document and sanitize every CSSOM rule
 * in-place.  This catches:
 *  - <style> tags (inline stylesheets)
 *  - <link> stylesheets (external, same-origin)
 *  - @media, @supports, @layer, @keyframes nested rules
 *  - CSS custom properties defined in rules
 */
function sanitizeCSSOMRules(doc: Document) {
    for (let s = 0; s < doc.styleSheets.length; s++) {
        let sheet: CSSStyleSheet;
        try {
            sheet = doc.styleSheets[s];
            // Accessing cssRules on cross-origin sheets throws SecurityError
            const rules = sheet.cssRules;
            for (let r = 0; r < rules.length; r++) {
                sanitizeCSSRule(rules[r]);
            }
        } catch {
            // Cross-origin stylesheet or other access error — skip
            continue;
        }
    }
}

// ─── Balanced-parenthesis color function replacer ─────────────────────────

/**
 * Find the extent of a balanced-paren expression starting *after* the
 * opening `(` at position `openPos`.  Returns the index of the matching
 * closing `)`, or -1 if unbalanced.
 */
function findMatchingParen(text: string, openPos: number): number {
    let depth = 1;
    for (let i = openPos + 1; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1; // unbalanced
}

/**
 * Replace all occurrences of unsupported CSS color functions in `text`
 * with the `replacement` string.  Handles arbitrarily nested parentheses
 * (e.g. `color-mix(in srgb, var(--a) 50%, var(--b) 50%)`).
 *
 * Works by scanning for function-name tokens followed by `(`, then using
 * balanced-paren matching to find the full extent of the call.
 */
function replaceUnsupportedColorFunctions(text: string, replacement = 'transparent'): string {
    // Build a pattern that matches the function name + opening paren.
    // We capture the function name to verify it is in our blocklist.
    const fnPattern = new RegExp(
        `\\b(${UNSUPPORTED_FN_NAMES.join('|')})\\s*\\(`,
        'gi'
    );

    // We rebuild the string in segments to handle overlapping / nested calls.
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset lastIndex for safety
    fnPattern.lastIndex = 0;

    while ((match = fnPattern.exec(text)) !== null) {
        const fnStart = match.index;
        const openParen = match.index + match[0].length - 1; // index of '('
        const closeParen = findMatchingParen(text, openParen);

        if (closeParen === -1) {
            // Unbalanced — replace from here to end of string
            result += text.slice(lastIndex, fnStart) + replacement;
            lastIndex = text.length;
            break;
        }

        // Append everything before this function call, then the replacement
        result += text.slice(lastIndex, fnStart) + replacement;
        lastIndex = closeParen + 1;

        // Advance the regex past the replaced section so we don't re-match
        // inside the (now-removed) function body.
        fnPattern.lastIndex = lastIndex;
    }

    // Append any remaining text after the last match
    result += text.slice(lastIndex);
    return result;
}

// ─── DOM sanitizer ────────────────────────────────────────────────────────

/**
 * Sanitize CSS color values that html2canvas cannot parse.
 * Runs on the cloned DOM inside html2canvas's iframe BEFORE it parses styles.
 *
 * Strategy (defense-in-depth — each layer catches what earlier layers miss):
 *  0. Sanitize all CSSOM rules in-place (the primary fix — html2canvas reads
 *     raw CSSOM rule objects, so this is the only way to guarantee it never
 *     encounters an unsupported color function in stylesheet rules)
 *  1. Replace unsupported color functions in `<style>` text content
 *  2. Sanitize inline style attributes that contain unsupported functions
 *  3. Override computed styles inline (with !important) so html2canvas's
 *     getComputedStyle reads safe values even if a stylesheet rule uses !important
 *  4. Sanitize CSS custom properties (--*) on elements
 */
function sanitizeUnsupportedColors(doc: Document, root: HTMLElement) {
    // 0. ★ CSSOM-level sanitization — walk ALL stylesheet rules and fix values
    //    in-place.  This is the primary defense: html2canvas reads the CSSOM
    //    rule objects directly, and modifying textContent alone doesn't reliably
    //    update parsed CSSOM objects.  This also catches <link> stylesheets.
    sanitizeCSSOMRules(doc);

    // 1. Sanitize <style> tags in the cloned document (belt-and-suspenders)
    const styles = doc.querySelectorAll('style');
    for (const style of Array.from(styles)) {
        if (style.textContent && UNSUPPORTED_COLOR_RE.test(style.textContent)) {
            style.textContent = replaceUnsupportedColorFunctions(style.textContent);
        }
    }

    // 2 & 3. Walk all elements and override computed styles with safe inline values
    const getCS = doc.defaultView?.getComputedStyle;
    if (!getCS) return;

    const allElements = root.querySelectorAll('*');
    const elementsArray = [root, ...Array.from(allElements)] as HTMLElement[];

    for (const el of elementsArray) {
        if (!el.style) continue;

        // 2a. Sanitize inline style attribute if it contains unsupported functions
        const inlineStyle = el.getAttribute('style');
        if (inlineStyle && UNSUPPORTED_COLOR_RE.test(inlineStyle)) {
            el.setAttribute('style', replaceUnsupportedColorFunctions(inlineStyle));
        }

        try {
            const cs = getCS.call(doc.defaultView, el);

            // 3. Check standard color properties — use !important to override
            //    any stylesheet !important rules that might defeat the inline fix
            for (const prop of COLOR_PROPS) {
                const val = cs.getPropertyValue(prop);
                if (val && UNSUPPORTED_COLOR_RE.test(val)) {
                    const fallback = prop === 'color' || prop === 'caret-color'
                        ? 'inherit'
                        : 'transparent';
                    el.style.setProperty(prop, fallback, 'important');
                }
            }

            // 4. Sanitize CSS custom properties (--*) on this element
            //    getComputedStyle doesn't enumerate custom properties in all
            //    browsers, but the inline style DOES. We also check inline
            //    styles set via <style> rules by iterating cs.
            //    For inline styles:
            for (let i = 0; i < el.style.length; i++) {
                const propName = el.style[i];
                if (propName.startsWith('--')) {
                    const val = el.style.getPropertyValue(propName);
                    if (val && UNSUPPORTED_COLOR_RE.test(val)) {
                        el.style.setProperty(propName, replaceUnsupportedColorFunctions(val), 'important');
                    }
                }
            }
        } catch {
            // getComputedStyle can fail on detached or pseudo elements — skip
        }
    }

    // 5. Sanitize :root / documentElement custom properties specifically
    //    These are often set by theme systems and contain color-mix() etc.
    const rootEl = doc.documentElement;
    if (rootEl?.style) {
        for (let i = 0; i < rootEl.style.length; i++) {
            const propName = rootEl.style[i];
            if (propName.startsWith('--')) {
                const val = rootEl.style.getPropertyValue(propName);
                if (val && UNSUPPORTED_COLOR_RE.test(val)) {
                    rootEl.style.setProperty(propName, replaceUnsupportedColorFunctions(val), 'important');
                }
            }
        }
    }
}

export const ScreenshotManager: React.FC = () => {
  useEffect(() => {
    const unsub = wsService.on('request-screenshot', async (payload: unknown) => {
        const { requestId, surfaceId } = payload as { requestId: string; surfaceId: string };
        console.log(`[ScreenshotManager] Received request for surface: ${surfaceId} (req: ${requestId})`);

        try {
            const element = document.getElementById(`surface-${surfaceId}`);
            if (!element) {
                console.error(`[ScreenshotManager] Element not found: #surface-${surfaceId}`);
                wsService.sendMessage('screenshot-captured', {
                    requestId,
                    error: `Surface element #${surfaceId} not found in DOM`
                });
                return;
            }

            // Capture the element
            // useCORS: true is often needed for external images, though surfaces are mostly local
            // logging: false to reduce noise
            // onclone: sanitize CSS Color Level 4 functions that html2canvas can't parse
            installGradientPatch();
            let canvas: HTMLCanvasElement;
            try {
                canvas = await html2canvas(element, {
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#080808', // Match theme background
                    onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
                        sanitizeUnsupportedColors(clonedDoc, clonedEl);
                    }
                });
            } finally {
                uninstallGradientPatch();
            }

            const image = canvas.toDataURL('image/jpeg', 0.8);
            
            wsService.sendMessage('screenshot-captured', {
                requestId,
                image
            });
            console.log(`[ScreenshotManager] Screenshot sent for surface: ${surfaceId}`);

        } catch (error) {
            console.error('[ScreenshotManager] Capture failed:', error);
            wsService.sendMessage('screenshot-captured', {
                requestId,
                error: `Capture failed: ${(error as Error).message}`
            });
        }
    });

    return () => {
        unsub();
    };
  }, []);

  return null; // Headless component
};
