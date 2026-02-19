import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * WebSocket message dispatcher.
 * Maps message `type` strings to handler functions and dispatches incoming messages.
 */
export class WsDispatcher {
    constructor() {
        /** @type {Map<string, (data: any, ctx: any) => Promise<void>>} */
        this._handlers = new Map();
    }

    /**
     * Register a handler for a specific message type.
     * @param {string} type — the `data.type` value to match
     * @param {(data: any, ctx: any) => Promise<void>} handler
     */
    register(type, handler) {
        this._handlers.set(type, handler);
    }

    /**
     * Register all handlers exported by a handler module.
     * The module should export a `handlers` object mapping type → handler function.
     * @param {Record<string, (data: any, ctx: any) => Promise<void>>} handlerMap
     */
    registerAll(handlerMap) {
        for (const [type, handler] of Object.entries(handlerMap)) {
            this._handlers.set(type, handler);
        }
    }

    /**
     * Dispatch a parsed message to its registered handler.
     * @param {object} data — parsed WebSocket message (must have a `type` field)
     * @param {object} ctx — context object passed to every handler
     * @returns {Promise<boolean>} true if a handler was found and invoked
     */
    async dispatch(data, ctx) {
        const handler = this._handlers.get(data.type);
        if (handler) {
            await handler(data, ctx);
            return true;
        }
        return false;
    }

    /**
     * Return the list of registered message types (useful for debugging).
     */
    get registeredTypes() {
        return [...this._handlers.keys()];
    }
}
