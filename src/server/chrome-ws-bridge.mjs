export class ChromeWsBridge {
    constructor(eventBus) {
        this.ws = null;
        this.eventBus = eventBus;
        this.pending = new Map();  // id → { resolve, reject, timeout }
        this.connected = false;
    }

    attach(ws) {
        this.ws = ws;
        this.connected = true;
        ws.on('message', msg => this._onMessage(JSON.parse(msg)));
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

    async send(action, params, timeout = 30000) {
        if (!this.connected) throw new Error('Chrome extension not connected');
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

    _onMessage(msg) {
        if (msg.id && this.pending.has(msg.id)) {
            // Response to a command
            const { resolve, reject, timeout } = this.pending.get(msg.id);
            clearTimeout(timeout);
            this.pending.delete(msg.id);
            if (msg.success) resolve(msg.data);
            else reject(new Error(msg.error || 'Unknown error'));
        } else if (msg.event) {
            // Push event from extension
            this.eventBus?.emit(`chrome:${msg.event}`, msg.data);
        }
    }
}
