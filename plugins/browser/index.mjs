/**
 * Oboto Browser Plugin
 *
 * Provides browser automation tools via Puppeteer (headless Chrome).
 * Extracted from src/execution/handlers/browser-handlers.mjs and
 * src/tools/definitions/browser-tools.mjs.
 *
 * @module @oboto/plugin-browser
 */

import puppeteer from 'puppeteer';

// ── BrowserSession — encapsulates all mutable browser state ──────────────

class BrowserSession {
    constructor() {
        this.browser = null;
        this.page = null;
        this.logs = [];
        this.networkLogs = [];
    }

    async ensureBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            this.page = await this.browser.newPage();

            // Set a real User-Agent to avoid being blocked by some sites
            await this.page.setUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            );

            // Capture console logs
            this.page.on('console', (msg) => {
                const logEntry = `[${msg.type()}] ${msg.text()}`;
                this.logs.push(logEntry);
                if (this.logs.length > 50) this.logs.shift();
            });

            this.page.on('pageerror', (err) => {
                this.logs.push(`[error] ${err.toString()}`);
            });

            // Capture network activity
            this.page.on('requestfailed', (request) => {
                this.networkLogs.push(
                    `[failed] ${request.method()} ${request.url()} - ${request.failure().errorText}`
                );
                if (this.networkLogs.length > 50) this.networkLogs.shift();
            });

            this.page.on('response', (response) => {
                if (!response.ok()) {
                    this.networkLogs.push(
                        `[${response.status()}] ${response.request().method()} ${response.url()}`
                    );
                    if (this.networkLogs.length > 50) this.networkLogs.shift();
                }
            });
        }
        return this.page;
    }

    async captureState(url, options = {}) {
        const { fullPage = false, error = null, action = null } = options;

        let screenshotBuffer = null;
        let title = 'Error';

        try {
            screenshotBuffer = await this.page.screenshot({
                encoding: 'base64',
                fullPage,
                type: 'jpeg',
                quality: 80
            });
            title = await this.page.title();
        } catch (e) {
            // Failed to capture screenshot — continue with null
        }

        return JSON.stringify({
            _type: 'browser_preview',
            url,
            title,
            logs: this.logs,
            networkLogs: this.networkLogs,
            screenshot: screenshotBuffer ? `data:image/jpeg;base64,${screenshotBuffer}` : null,
            error,
            lastAction: action
        });
    }

    async cleanup() {
        try {
            if (this.browser) await this.browser.close();
        } catch {
            /* ignore cleanup errors */
        }
        this.browser = null;
        this.page = null;
        this.logs = [];
        this.networkLogs = [];
    }

    // ── Tool handlers ────────────────────────────────────────────────────

    async browseOpen(args) {
        const {
            url = 'about:blank',
            width = 1280,
            height = 800,
            wait_condition = 'networkidle0'
        } = args;

        try {
            const p = await this.ensureBrowser();

            await p.setViewport({ width, height });
            this.logs = [];
            this.networkLogs = [];

            await p.goto(url, { waitUntil: wait_condition, timeout: 30000 });

            return await this.captureState(url, { action: { type: 'open', url } });
        } catch (error) {
            // Check if the page is still usable (attached) before trying to capture
            const pageAttached = this.page && !this.page.isClosed();
            if (pageAttached) {
                return await this.captureState(url, {
                    error: error.message,
                    action: { type: 'open', url }
                });
            }

            // Clean up dead browser session so subsequent tools get clear error
            await this.cleanup();
            return `Error: Failed to open ${url} — ${error.message}. The browser session has been cleaned up.`;
        }
    }

    async browseAct(args) {
        const { action, selector, value, wait_time, wait_for_navigation } = args;

        if (!this.browser || !this.page) {
            return "Error: No active browser session. Use 'browse_open' first.";
        }

        try {
            const performAction = async () => {
                switch (action) {
                    case 'click':
                        await this.page.waitForSelector(selector, { timeout: 5000 });
                        await this.page.click(selector);
                        break;
                    case 'type':
                        await this.page.waitForSelector(selector, { timeout: 5000 });
                        await this.page.type(selector, value);
                        break;
                    case 'scroll':
                        if (value) {
                            await this.page.evaluate((y) => window.scrollBy(0, y), parseInt(value));
                        } else {
                            await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                        }
                        break;
                    case 'wait':
                        await new Promise((r) => setTimeout(r, wait_time || 1000));
                        break;
                    case 'hover':
                        await this.page.waitForSelector(selector, { timeout: 5000 });
                        await this.page.hover(selector);
                        break;
                    case 'enter':
                        await this.page.keyboard.press('Enter');
                        break;
                }
            };

            if (wait_for_navigation) {
                await Promise.all([
                    this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
                    performAction()
                ]);
            } else {
                await performAction();
                await new Promise((r) => setTimeout(r, 500));
            }

            return await this.captureState(this.page.url(), { action: { type: action, selector, value } });
        } catch (error) {
            return await this.captureState(this.page.url(), {
                error: error.message,
                action: { type: action, selector, value }
            });
        }
    }

    async browseScreenshot(args) {
        if (!this.browser || !this.page) {
            return "Error: No active browser session. Use 'browse_open' first.";
        }
        if (this.page.isClosed()) {
            await this.cleanup();
            return "Error: Browser page is closed. Use 'browse_open' to start a new session.";
        }
        return await this.captureState(this.page.url(), {
            fullPage: args.full_page,
            action: { type: 'screenshot' }
        });
    }

    async browseClose() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.logs = [];
            this.networkLogs = [];
            return 'Browser session closed.';
        }
        return 'No active browser session to close.';
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

// NOTE: Plugin state is stored on the `api` object rather than in a module-level
// variable. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up the session via `api._pluginInstance`, and the
// new module starts fresh.

export async function activate(api) {
    const session = new BrowserSession();
    api._pluginInstance = session;

    api.tools.register({
        useOriginalName: true,
        name: 'browse_open',
        description:
            'Opens a URL in the internal headless browser and returns a screenshot and console logs.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description:
                        'The URL to navigate to (e.g., http://localhost:3000). Defaults to about:blank.',
                    default: 'about:blank'
                },
                width: {
                    type: 'number',
                    description: 'Viewport width (default: 1280)',
                    default: 1280
                },
                height: {
                    type: 'number',
                    description: 'Viewport height (default: 800)',
                    default: 800
                },
                wait_condition: {
                    type: 'string',
                    enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'],
                    description: 'When to consider navigation finished (default: networkidle0)',
                    default: 'networkidle0'
                }
            },
            required: []
        },
        handler: (args) => session.browseOpen(args)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'browse_act',
        description:
            'Interacts with the current page (click, type, etc.) and returns updated state.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['click', 'type', 'scroll', 'wait', 'hover', 'enter'],
                    description: 'Action to perform'
                },
                selector: {
                    type: 'string',
                    description:
                        'CSS selector of the element to interact with (required for click/type/hover)'
                },
                value: {
                    type: 'string',
                    description:
                        "Value to type (for 'type' action) or amount to scroll (for 'scroll')"
                },
                wait_time: {
                    type: 'number',
                    description: "Time to wait in ms (for 'wait' action)"
                },
                wait_for_navigation: {
                    type: 'boolean',
                    description: 'Wait for page navigation after action (default: false)',
                    default: false
                }
            },
            required: ['action']
        },
        handler: (args) => session.browseAct(args)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'browse_screenshot',
        description: 'Takes a screenshot of the current page state.',
        parameters: {
            type: 'object',
            properties: {
                full_page: {
                    type: 'boolean',
                    description: 'Capture full scrollable page (default: false)',
                    default: false
                }
            }
        },
        handler: (args) => session.browseScreenshot(args)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'browse_close',
        description: 'Closes the browser session.',
        parameters: {
            type: 'object',
            properties: {}
        },
        handler: () => session.browseClose()
    });
}

export async function deactivate(api) {
    if (api._pluginInstance) {
        await api._pluginInstance.cleanup();
        api._pluginInstance = null;
    }
}
