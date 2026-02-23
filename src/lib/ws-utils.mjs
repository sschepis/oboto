// Shared WebSocket utilities
// Consolidated from 215+ inline ws.send(JSON.stringify({...})) patterns
// See docs/DUPLICATE_CODE_ANALYSIS.md — OPT-1, OPT-2, OPT-5

import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Send a typed JSON message over a WebSocket connection.
 *
 * @param {import('ws').WebSocket} ws - WebSocket connection
 * @param {string} type - Message type identifier
 * @param {*} payload - Message payload (will be JSON-serialized)
 *
 * @example
 *   wsSend(ws, 'conversation-list', conversations);
 *   wsSend(ws, 'error', 'Something went wrong');
 */
export function wsSend(ws, type, payload) {
    if (ws && ws.readyState === 1) { // WebSocket.OPEN = 1
        ws.send(JSON.stringify({ type, payload }));
    }
}

/**
 * Send an error message over WebSocket.
 *
 * @param {import('ws').WebSocket} ws - WebSocket connection
 * @param {string} message - Error message
 * @param {string} [errorType='error'] - Error type identifier
 */
export function wsSendError(ws, message, errorType = 'error') {
    wsSend(ws, errorType, message);
}

/**
 * Resolve a dotted path to a service from the handler context.
 * Returns null and sends an error to the client if the service is unavailable.
 *
 * @param {Object} ctx - Handler context (must contain ws, assistant)
 * @param {string} path - Dot-separated path, e.g. 'toolExecutor.surfaceManager'
 * @param {string} [label] - Human-readable label for the error message
 * @returns {*|null} The resolved service, or null if unavailable
 *
 * @example
 *   const sm = requireService(ctx, 'toolExecutor.surfaceManager', 'Surface manager');
 *   if (!sm) return;
 */
export function requireService(ctx, path, label) {
    const parts = path.split('.');
    let current = ctx.assistant;
    for (const part of parts) {
        current = current?.[part];
        if (!current) {
            const name = label || path;
            wsSendError(ctx.ws, `${name} not available`);
            return null;
        }
    }
    return current;
}

/**
 * Higher-order function that wraps a ws-handler with:
 * - Automatic try/catch with error logging and ws error response
 * - Optional service guard (require a service to be present)
 *
 * @param {Function} fn - async (data, ctx, svc) => void  —  the core handler logic
 * @param {Object} [options]
 * @param {string} [options.require] - Dot path to a required service (e.g. 'toolExecutor.surfaceManager')
 * @param {string} [options.requireLabel] - Human-readable label for the required service
 * @param {string} [options.errorType='error'] - Message type for error responses
 * @param {string} [options.errorPrefix] - Optional prefix for the error message
 * @returns {Function} Wrapped handler: async (data, ctx) => void
 *
 * @example
 *   const handleGetSurfaces = wsHandler(async (data, ctx, sm) => {
 *       const surfaces = await sm.listSurfaces();
 *       wsSend(ctx.ws, 'surface-list', surfaces);
 *   }, { require: 'toolExecutor.surfaceManager', requireLabel: 'Surface manager' });
 */
export function wsHandler(fn, options = {}) {
    const { require: reqPath, requireLabel, errorType = 'error', errorPrefix } = options;

    return async (data, ctx) => {
        let svc = null;
        if (reqPath) {
            svc = requireService(ctx, reqPath, requireLabel);
            if (!svc) return;
        }

        try {
            await fn(data, ctx, svc);
        } catch (err) {
            const prefix = errorPrefix ? `${errorPrefix}: ` : '';
            consoleStyler.log('error', `${prefix}${err.message}`);
            wsSendError(ctx.ws, `${prefix}${err.message}`, errorType);
        }
    };
}
