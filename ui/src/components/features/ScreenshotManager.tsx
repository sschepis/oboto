import React, { useEffect } from 'react';
import html2canvas from 'html2canvas';
import { wsService } from '../../services/wsService';

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
    'color', 'background-color', 'background',
    'border-color',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow',
    'caret-color', 'column-rule-color', 'fill', 'stroke',
    'accent-color',
];

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
 * Strategy:
 *  1. Replace unsupported color functions in `<style>` text content
 *  2. Sanitize inline style attributes that contain unsupported functions
 *  3. Override computed styles inline so html2canvas's getComputedStyle reads safe values
 *  4. Sanitize CSS custom properties (--*) on elements that contain unsupported functions
 */
function sanitizeUnsupportedColors(doc: Document, root: HTMLElement) {
    // 1. Sanitize <style> tags in the cloned document
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

            // 3. Check standard color properties
            for (const prop of COLOR_PROPS) {
                const val = cs.getPropertyValue(prop);
                if (val && UNSUPPORTED_COLOR_RE.test(val)) {
                    const fallback = prop === 'color' || prop === 'caret-color'
                        ? 'inherit'
                        : 'transparent';
                    el.style.setProperty(prop, fallback);
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
                        el.style.setProperty(propName, replaceUnsupportedColorFunctions(val));
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
                    rootEl.style.setProperty(propName, replaceUnsupportedColorFunctions(val));
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
            const canvas = await html2canvas(element, {
                useCORS: true,
                logging: false,
                backgroundColor: '#080808', // Match theme background
                onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
                    sanitizeUnsupportedColors(clonedDoc, clonedEl);
                }
            });

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
