/**
 * Oboto Chrome Extension Plugin
 *
 * Provides tools for controlling a real Chrome browser via the Oboto Chrome
 * extension.  Communication happens over a WebSocket bridge: the extension
 * connects to the server, and this plugin sends commands and receives
 * responses through that bridge.
 *
 * Extracted from:
 *   - src/execution/handlers/chrome-ext-handlers.mjs
 *   - src/tools/definitions/chrome-ext-tools.mjs
 *   - src/server/chrome-ws-bridge.mjs
 *
 * @module @oboto/plugin-chrome-ext
 */

// ── Chrome WebSocket Bridge ──────────────────────────────────────────────

class ChromeWsBridge {
    constructor() {
        this.ws = null;
        this.pending = new Map(); // id → { resolve, reject, timeout }
        this.connected = false;
        this._eventHandler = null; // optional callback for push events
    }

    /**
     * Attach a WebSocket connection (called when the Chrome extension connects).
     * @param {WebSocket} ws
     */
    attach(ws) {
        this.ws = ws;
        this.connected = true;

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                this._onMessage(msg);
            } catch {
                /* ignore malformed messages */
            }
        });

        ws.on('close', () => {
            this.connected = false;
            this.ws = null;
            // Reject all pending requests
            for (const [id, { reject, timeout }] of this.pending) {
                clearTimeout(timeout);
                reject(new Error('Chrome extension disconnected'));
            }
            this.pending.clear();
        });
    }

    /**
     * Send a command to the Chrome extension and wait for a response.
     * @param {string} action
     * @param {object} params
     * @param {number} [timeout=30000]
     * @returns {Promise<unknown>}
     */
    async send(action, params, timeout = 30000) {
        if (!this.connected) {
            throw new Error('Chrome extension not connected');
        }
        const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Chrome command '${action}' timed out`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timeout: timer });
            this.ws.send(JSON.stringify({ id, action, params }));
        });
    }

    /** @private */
    _onMessage(msg) {
        if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject, timeout } = this.pending.get(msg.id);
            clearTimeout(timeout);
            this.pending.delete(msg.id);
            if (msg.success) resolve(msg.data);
            else reject(new Error(msg.error || 'Unknown error'));
        } else if (msg.event && this._eventHandler) {
            this._eventHandler(msg.event, msg.data);
        }
    }

    /**
     * Tear down the bridge (reject pending, close socket).
     */
    destroy() {
        for (const [, { reject, timeout }] of this.pending) {
            clearTimeout(timeout);
            reject(new Error('Chrome extension bridge destroyed'));
        }
        this.pending.clear();
        if (this.ws) {
            try { this.ws.close(); } catch { /* ignore */ }
        }
        this.ws = null;
        this.connected = false;
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

// NOTE: Plugin state is stored on the `api` object rather than in a module-level
// variable. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up the bridge via `api._pluginInstance`, and the
// new module starts fresh.

export async function activate(api) {
    const bridge = new ChromeWsBridge();
    api._pluginInstance = { bridge };

    // Forward push events from the Chrome extension as plugin events
    bridge._eventHandler = (event, data) => {
        api.events.emit(`chrome:${event}`, data);
    };

    // Register a WS handler so the Chrome extension can connect through the
    // plugin's WebSocket namespace.  When the server receives a message of
    // type "plugin:chrome-ext:connect", we attach the WS to the bridge.
    api.ws.register('connect', (data, ctx) => {
        if (ctx && ctx.ws) {
            bridge.attach(ctx.ws);
            return { status: 'connected' };
        }
        return { status: 'error', message: 'No WebSocket in context' };
    });

    // ── Tool handler closures (capture local `bridge`) ───────────────────

    const listTabs = (args) => bridge.send('tabs.query', {
        windowId: args.windowId,
        active: args.active,
        url: args.url
    });
    const createTab = (args) => bridge.send('tabs.create', args);
    const closeTab = (args) => bridge.send('tabs.close', { tabIds: args.tabIds });
    const navigate = (args) => bridge.send('navigate', args);
    const listWindows = () => bridge.send('windows.getAll', {});
    const createWindow = (args) => bridge.send('windows.create', args);
    const closeWindow = (args) => bridge.send('windows.close', { windowId: args.windowId });
    const click = (args) => bridge.send('dom.click', args);
    const type = (args) => bridge.send('dom.type', args);
    const evaluate = (args) => bridge.send('dom.evaluate', args);
    const screenshot = (args) => bridge.send('tabs.screenshot', args);
    const getPageInfo = (args) => bridge.send('dom.getPageInfo', args);
    const queryDom = (args) => bridge.send('dom.querySelectorAll', args);
    const fillForm = (args) => bridge.send('dom.fillForm', args);
    const scroll = (args) => bridge.send('dom.scrollTo', args);
    const waitFor = (args) => {
        if (args.selector || args.text) return bridge.send('page.waitForSelector', args);
        else if (args.url) return bridge.send('page.waitForUrl', args);
        return bridge.send('page.waitForSelector', args);
    };
    const cdpCommand = (args) => bridge.send('debugger.sendCommand', args);
    const extractContent = (args) => bridge.send('dom.extractContent', args);
    const cookiesManage = (args) => {
        switch (args.action) {
            case 'get': return bridge.send('cookies.get', args);
            case 'set': return bridge.send('cookies.set', args);
            case 'delete': return bridge.send('cookies.remove', args);
            default: throw new Error(`Unknown cookie action: ${args.action}`);
        }
    };

    // ── Tab Management ───────────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_list_tabs',
        description: 'List all open browser tabs with their URLs, titles, and IDs',
        parameters: {
            type: 'object',
            properties: {
                windowId: { type: 'number', description: 'Filter by window ID (optional)' },
                active: { type: 'boolean', description: 'Filter active tabs only' },
                url: { type: 'string', description: 'URL pattern to match' }
            }
        },
        handler: listTabs
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_create_tab',
        description: 'Open a new browser tab',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to open' },
                active: { type: 'boolean', description: 'Whether to make the tab active', default: true },
                windowId: { type: 'number', description: 'Window to open in' }
            },
            required: ['url']
        },
        handler: createTab
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_close_tab',
        description: 'Close one or more browser tabs',
        parameters: {
            type: 'object',
            properties: {
                tabIds: {
                    oneOf: [
                        { type: 'number' },
                        { type: 'array', items: { type: 'number' } }
                    ],
                    description: 'Tab ID or array of tab IDs to close'
                }
            },
            required: ['tabIds']
        },
        handler: closeTab
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_navigate',
        description: 'Navigate a tab to a URL',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID to navigate (omit for active tab)' },
                url: { type: 'string', description: 'URL to navigate to' },
                waitForLoad: { type: 'boolean', description: 'Wait for page load to complete', default: true }
            },
            required: ['url']
        },
        handler: navigate
    });

    // ── Window Management ────────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_list_windows',
        description: 'List all open browser windows',
        parameters: { type: 'object', properties: {} },
        handler: listWindows
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_create_window',
        description: 'Open a new browser window',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to open in the new window' },
                type: { type: 'string', enum: ['normal', 'popup', 'panel'], default: 'normal' },
                width: { type: 'number' },
                height: { type: 'number' },
                left: { type: 'number' },
                top: { type: 'number' },
                incognito: { type: 'boolean', default: false }
            }
        },
        handler: createWindow
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_close_window',
        description: 'Close a browser window',
        parameters: {
            type: 'object',
            properties: {
                windowId: { type: 'number', description: 'Window ID to close' }
            },
            required: ['windowId']
        },
        handler: closeWindow
    });

    // ── DOM Interaction ──────────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_click',
        description: 'Click an element on the page',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                selector: { type: 'string', description: 'CSS selector of element to click' }
            },
            required: ['selector']
        },
        handler: click
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_type',
        description: 'Type text into an input element',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                selector: { type: 'string', description: 'CSS selector of input element' },
                text: { type: 'string', description: 'Text to type' },
                clearFirst: { type: 'boolean', description: 'Clear existing value before typing', default: false }
            },
            required: ['selector', 'text']
        },
        handler: type
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_evaluate',
        description: "Execute JavaScript in a tab's page context and return the result",
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                expression: { type: 'string', description: 'JavaScript expression to evaluate' },
                awaitPromise: { type: 'boolean', description: 'If expression returns a Promise, await it', default: false }
            },
            required: ['expression']
        },
        handler: evaluate
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_screenshot',
        description: "Take a screenshot of a tab's visible area",
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                format: { type: 'string', enum: ['png', 'jpeg'], default: 'jpeg' },
                quality: { type: 'number', description: 'JPEG quality 0-100', default: 80 }
            }
        },
        handler: screenshot
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_get_page_info',
        description: 'Get comprehensive information about the current page: title, URL, meta tags, headings, links, forms, and visible text summary',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                includeLinks: { type: 'boolean', default: true },
                includeForms: { type: 'boolean', default: true },
                includeHeadings: { type: 'boolean', default: true },
                maxTextLength: { type: 'number', description: 'Max chars of visible text to return', default: 5000 }
            }
        },
        handler: getPageInfo
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_query_dom',
        description: 'Query the DOM using CSS selectors and return matching elements with their attributes, text, and positions',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                selector: { type: 'string', description: 'CSS selector' },
                limit: { type: 'number', description: 'Max number of elements to return', default: 20 }
            },
            required: ['selector']
        },
        handler: queryDom
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_fill_form',
        description: 'Fill multiple form fields at once',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                fields: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            selector: { type: 'string' },
                            value: { type: 'string' }
                        },
                        required: ['selector', 'value']
                    },
                    description: 'Array of selector/value pairs to fill'
                },
                submit: { type: 'boolean', description: 'Submit the form after filling', default: false }
            },
            required: ['fields']
        },
        handler: fillForm
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_scroll',
        description: 'Scroll the page or an element',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], default: 'down' },
                amount: { type: 'number', description: 'Pixels to scroll (for up/down)', default: 500 },
                selector: { type: 'string', description: 'CSS selector of scrollable element (omit for page)' }
            }
        },
        handler: scroll
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_wait_for',
        description: 'Wait for a condition on the page: element to appear, URL to match, or text to be present',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                selector: { type: 'string', description: 'CSS selector to wait for' },
                text: { type: 'string', description: 'Text content to wait for' },
                url: { type: 'string', description: 'URL pattern to wait for' },
                timeout: { type: 'number', description: 'Max wait time in ms', default: 10000 }
            }
        },
        handler: waitFor
    });

    // ── Advanced: CDP direct access ──────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_cdp_command',
        description: 'Send a raw Chrome DevTools Protocol command. For advanced automation: network interception, performance profiling, DOM snapshotting, etc.',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                method: { type: 'string', description: "CDP method (e.g. 'Network.enable', 'Page.captureScreenshot')" },
                params: { type: 'object', description: 'CDP command parameters' }
            },
            required: ['method']
        },
        handler: cdpCommand
    });

    // ── Utility ──────────────────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_extract_content',
        description: 'Extract structured content from the current page: article text, tables, lists, images, or all structured data',
        parameters: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: 'Tab ID (omit for active tab)' },
                type: { type: 'string', enum: ['text', 'tables', 'links', 'images', 'forms', 'all'], default: 'all' }
            }
        },
        handler: extractContent
    });

    api.tools.register({
        useOriginalName: true,
        name: 'chrome_cookies_manage',
        description: 'Get, set, or delete cookies',
        parameters: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['get', 'set', 'delete'] },
                url: { type: 'string', description: 'URL associated with the cookie' },
                name: { type: 'string', description: 'Cookie name' },
                value: { type: 'string', description: 'Cookie value (for set)' },
                domain: { type: 'string', description: 'Cookie domain' }
            },
            required: ['action', 'url']
        },
        handler: cookiesManage
    });
}

export async function deactivate(api) {
    if (api._pluginInstance?.bridge) {
        api._pluginInstance.bridge.destroy();
    }
    api._pluginInstance = null;
}
