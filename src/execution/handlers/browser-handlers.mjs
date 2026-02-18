import puppeteer from 'puppeteer';
import { consoleStyler } from '../../ui/console-styler.mjs';

export class BrowserHandlers {
    constructor() {
        this.browser = null;
        this.page = null;
        this.logs = [];
        this.networkLogs = [];
    }

    async ensureBrowser() {
        if (!this.browser) {
            consoleStyler.log('working', 'Launching headless browser...');
            this.browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            this.page = await this.browser.newPage();
            
            // Set a real User-Agent to avoid being blocked by some sites
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
            
            // Capture console logs
            this.page.on('console', msg => {
                const logEntry = `[${msg.type()}] ${msg.text()}`;
                this.logs.push(logEntry);
                if (this.logs.length > 50) this.logs.shift();
            });

            this.page.on('pageerror', err => {
                this.logs.push(`[error] ${err.toString()}`);
            });

            // Capture network activity
            this.page.on('requestfailed', request => {
                this.networkLogs.push(`[failed] ${request.method()} ${request.url()} - ${request.failure().errorText}`);
                if (this.networkLogs.length > 50) this.networkLogs.shift();
            });

            this.page.on('response', response => {
                if (!response.ok()) {
                    this.networkLogs.push(`[${response.status()}] ${response.request().method()} ${response.url()}`);
                    if (this.networkLogs.length > 50) this.networkLogs.shift();
                }
            });
        }
        return this.page;
    }

    async browseOpen(args) {
        const { url = 'about:blank', width = 1280, height = 800, wait_condition = 'networkidle0' } = args;
        
        try {
            consoleStyler.log('working', `Browsing to: ${url}`);
            const page = await this.ensureBrowser();
            
            await page.setViewport({ width, height });
            this.logs = []; // Clear logs on new navigation
            this.networkLogs = [];
            
            await page.goto(url, { waitUntil: wait_condition, timeout: 30000 });
            
            return await this.captureState(url, { action: { type: 'open', url } });
        } catch (error) {
            consoleStyler.log('error', `Browse failed: ${error.message}`);
            // Try to capture state even on failure if page exists
            if (this.page) {
                return await this.captureState(url, { error: error.message, action: { type: 'open', url } });
            }
            // Return a JSON error state if we can't capture the page
            return JSON.stringify({
                _type: 'browser_preview',
                url,
                title: 'Error',
                logs: [],
                networkLogs: [],
                screenshot: null,
                error: error.message,
                lastAction: { type: 'open', url }
            });
        }
    }

    async browseAct(args) {
        const { action, selector, value, wait_time, wait_for_navigation } = args;
        
        if (!this.browser || !this.page) {
            return "Error: No active browser session. Use 'browse_open' first.";
        }

        try {
            const page = this.page;
            consoleStyler.log('working', `Browser Action: ${action} ${selector || ''}`);

            const performAction = async () => {
                switch (action) {
                    case 'click':
                        await page.waitForSelector(selector, { timeout: 5000 });
                        await page.click(selector);
                        break;
                    case 'type':
                        await page.waitForSelector(selector, { timeout: 5000 });
                        await page.type(selector, value);
                        break;
                    case 'scroll':
                         if (value) {
                            await page.evaluate((y) => window.scrollBy(0, y), parseInt(value));
                         } else {
                            // Scroll to bottom
                            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                         }
                        break;
                    case 'wait':
                        await new Promise(r => setTimeout(r, wait_time || 1000));
                        break;
                    case 'hover':
                        await page.waitForSelector(selector, { timeout: 5000 });
                        await page.hover(selector);
                        break;
                    case 'enter':
                        await page.keyboard.press('Enter');
                        break;
                }
            };

            if (wait_for_navigation) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }),
                    performAction()
                ]);
            } else {
                await performAction();
                // Wait a bit for any reactions if not navigating
                await new Promise(r => setTimeout(r, 500));
            }
            
            return await this.captureState(page.url(), { action: { type: action, selector, value } });
        } catch (error) {
             consoleStyler.log('error', `Browser action failed: ${error.message}`);
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
        return await this.captureState(this.page.url(), { fullPage: args.full_page, action: { type: 'screenshot' } });
    }

    async browseClose() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.logs = [];
            this.networkLogs = [];
            return "Browser session closed.";
        }
        return "No active browser session to close.";
    }

    async captureState(url, options = {}) {
        const { fullPage = false, error = null, action = null } = options;
        
        let screenshotBuffer = null;
        let title = 'Error';

        try {
            screenshotBuffer = await this.page.screenshot({ 
                encoding: 'base64', 
                fullPage: fullPage,
                type: 'jpeg',
                quality: 80
            });
            title = await this.page.title();
        } catch (e) {
            consoleStyler.log('error', `Failed to capture screenshot: ${e.message}`);
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
}
