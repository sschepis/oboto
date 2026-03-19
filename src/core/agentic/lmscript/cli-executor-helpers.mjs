/**
 * Pure utility functions and constants for the CLI executor.
 *
 * Extracted from cli-executor.mjs to reduce file size while keeping
 * all behaviour identical.
 *
 * @module src/core/agentic/lmscript/cli-executor-helpers
 */

import vm from 'node:vm';

// ──────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────

/** Default timeout for dynamic tool execution (ms). */
export const DYNAMIC_TOOL_TIMEOUT = 15_000;

/** Default timeout for HTTP requests (ms). */
export const HTTP_TIMEOUT = 30_000;

/** Pre-compiled regex for parsing COMMAND prefix. */
export const RE_COMMAND = /^COMMAND\s+(\w+)\s*([\s\S]*)/i;
export const RE_DIRECT = /^(\w+)\s*([\s\S]*)/i;

/**
 * Shared sandbox template for dynamic tool execution.
 * Creates a new shallow copy per execution to prevent cross-invocation state leaks
 * while avoiding the cost of reconstructing the full property set each time.
 */
export const SANDBOX_TEMPLATE = {
    console: Object.freeze({ log: () => {}, warn: () => {}, error: () => {} }),
    JSON,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
};

// ──────────────────────────────────────────────────────────────────
// Pure utility functions
// ──────────────────────────────────────────────────────────────────

/**
 * Check whether a URL targets a private/internal/link-local address.
 * Used by both built-in HTTP_GET and the dynamic-tool sandbox to prevent SSRF.
 *
 * KNOWN LIMITATION: This check is hostname-based only and does NOT prevent
 * DNS rebinding attacks.  A malicious domain (e.g. evil.example.com) could
 * pass all hostname checks here but resolve to 127.0.0.1 at DNS resolution
 * time.  For production-grade SSRF prevention, resolve DNS first with
 * `dns.resolve4()` / `dns.resolve6()` and validate the resolved IPs, or use
 * a connect-time socket check via the `net.connect` event.  In this context
 * (AI agent CLI tool, not a public-facing proxy), the hostname check
 * provides reasonable defense-in-depth.
 *
 * @param {string} urlString
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function checkSSRF(urlString) {
    let parsed;
    try { parsed = new URL(urlString); } catch {
        return { blocked: true, reason: `Invalid URL "${urlString}"` };
    }
    // Lowercase for defense-in-depth — URL spec normalizes hostnames but
    // we don't want to rely on runtime behaviour for a security check.
    const host = parsed.hostname.toLowerCase();
    const blocked = ['127.0.0.1', 'localhost', '0.0.0.0', '[::1]'];
    if (blocked.includes(host)) {
        return { blocked: true, reason: `blocked private/internal host "${host}"` };
    }
    // Block entire link-local range 169.254.0.0/16 (not just the AWS metadata endpoint)
    if (/^169\.254\./.test(host)) {
        return { blocked: true, reason: `blocked link-local host "${host}"` };
    }
    // Block all IPv6 addresses — they can encode loopback/private ranges in many forms
    // (e.g. [::ffff:127.0.0.1], [0:0:0:0:0:0:0:1], [::ffff:a]). Restricting to IPv4
    // only is the safest approach for an AI-driven HTTP client.
    if (host.startsWith('[') || host.includes(':')) {
        return { blocked: true, reason: `blocked IPv6 address "${host}" — use IPv4 only` };
    }
    // Block 0.0.0.0/8 range (not just 0.0.0.0 itself)
    if (/^0\./.test(host)) return { blocked: true, reason: `blocked zero-prefix host "${host}"` };
    // RFC 1918: 10.0.0.0/8
    if (host.startsWith('10.')) return { blocked: true, reason: `blocked RFC-1918 host "${host}"` };
    // RFC 1918: 172.16.0.0/12  (172.16.* – 172.31.*)
    const m172 = host.match(/^172\.(\d+)\./);
    if (m172) {
        const second = parseInt(m172[1], 10);
        if (second >= 16 && second <= 31) {
            return { blocked: true, reason: `blocked RFC-1918 host "${host}"` };
        }
    }
    // RFC 1918: 192.168.0.0/16
    if (host.startsWith('192.168.')) return { blocked: true, reason: `blocked RFC-1918 host "${host}"` };
    // CGNAT (Carrier-Grade NAT) 100.64.0.0/10 — used by cloud providers for internal metadata
    const m100 = host.match(/^100\.(\d+)\./);
    if (m100) {
        const second = parseInt(m100[1], 10);
        if (second >= 64 && second <= 127) {
            return { blocked: true, reason: `blocked CGNAT host "${host}"` };
        }
    }
    // Benchmark/testing 198.18.0.0/15
    const m198 = host.match(/^198\.(1[89])\./);
    if (m198) {
        return { blocked: true, reason: `blocked benchmark range host "${host}"` };
    }
    // Internal/local domains
    if (host.endsWith('.internal') || host.endsWith('.local')) {
        return { blocked: true, reason: `blocked internal/local host "${host}"` };
    }
    return { blocked: false };
}

/**
 * Split a command string by pipe operator, respecting quoted strings.
 * Escaped pipes within quoted strings are preserved.
 * @param {string} cmdString
 * @returns {string[]}
 */
export function splitPipe(cmdString) {
    const stages = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = 0; i < cmdString.length; i++) {
        const ch = cmdString[i];

        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === '\\') {
            escaped = true;
            current += ch;
            continue;
        }

        if (ch === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += ch;
            continue;
        }

        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += ch;
            continue;
        }

        if (ch === '|' && !inSingleQuote && !inDoubleQuote) {
            stages.push(current.trim());
            current = '';
            continue;
        }

        current += ch;
    }

    if (current.trim()) {
        stages.push(current.trim());
    }

    return stages;
}

/**
 * Wrap a promise with a timeout.
 * @param {Promise} promise
 * @param {number} ms
 * @param {string} timeoutMessage
 * @returns {Promise}
 */
export function withTimeout(promise, ms, timeoutMessage) {
    let timer;
    const cleanup = (v) => { clearTimeout(timer); return v; };
    return Promise.race([
        promise.then(cleanup, (err) => { clearTimeout(timer); throw err; }),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
        })
    ]);
}

/**
 * Extract text from args, stripping surrounding quotes if present.
 * Preserves quoted content as a single argument.
 * @param {string} args
 * @returns {string}
 */
export function extractQuotedOrRaw(args) {
    if (!args) return '';
    const trimmed = args.trim();
    // Strip surrounding double or single quotes
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
