export class ChromeExtensionHandlers {
    constructor(chromeWsBridge) {
        this.bridge = chromeWsBridge;
    }

    async listTabs(args) {
        return this.bridge.send('tabs.query', {
            windowId: args.windowId,
            active: args.active,
            url: args.url
        });
    }

    async createTab(args) {
        return this.bridge.send('tabs.create', args);
    }

    async closeTab(args) {
        return this.bridge.send('tabs.close', { tabIds: args.tabIds });
    }

    async navigate(args) {
        return this.bridge.send('navigate', args);
    }

    async listWindows(args) {
        return this.bridge.send('windows.getAll', {});
    }

    async createWindow(args) {
        return this.bridge.send('windows.create', args);
    }

    async closeWindow(args) {
        return this.bridge.send('windows.close', { windowId: args.windowId });
    }

    async click(args) {
        return this.bridge.send('dom.click', args);
    }

    async type(args) {
        return this.bridge.send('dom.type', args);
    }

    async evaluate(args) {
        return this.bridge.send('dom.evaluate', args);
    }

    async screenshot(args) {
        return this.bridge.send('tabs.screenshot', args);
    }

    async getPageInfo(args) {
        return this.bridge.send('dom.getPageInfo', args);
    }

    async queryDom(args) {
        return this.bridge.send('dom.querySelectorAll', args);
    }

    async fillForm(args) {
        return this.bridge.send('dom.fillForm', args);
    }

    async scroll(args) {
        return this.bridge.send('dom.scrollTo', args);
    }

    async waitFor(args) {
        // Dispatch based on what we're waiting for
        if (args.selector || args.text) {
            return this.bridge.send('page.waitForSelector', args);
        } else if (args.url) {
            // Not explicitly in routing table, but consistent with naming
            return this.bridge.send('page.waitForUrl', args); 
        }
        return this.bridge.send('page.waitForSelector', args);
    }

    async cdpCommand(args) {
        return this.bridge.send('debugger.sendCommand', args);
    }

    async extractContent(args) {
        // Map high-level extraction types to specific commands if needed, 
        // or send a generic one. Using generic 'dom.extractContent' for flexibility.
        return this.bridge.send('dom.extractContent', args);
    }

    async cookiesManage(args) {
        switch (args.action) {
            case 'get':
                return this.bridge.send('cookies.get', args);
            case 'set':
                return this.bridge.send('cookies.set', args);
            case 'delete':
                return this.bridge.send('cookies.remove', args);
            default:
                throw new Error(`Unknown cookie action: ${args.action}`);
        }
    }
}
