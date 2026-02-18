import crypto from 'crypto';

export class OpenClawHandlers {
    constructor(openClawManager) {
        this.manager = openClawManager;
    }

    async delegateToOpenClaw(args) {
        const { message, sessionKey, thinking } = args;

        if (!this.manager || !this.manager.client) {
            return "Error: OpenClaw integration is not available.";
        }

        if (!this.manager.client.isConnected) {
            return "Error: OpenClaw is not connected. Use openclaw_status to check the connection.";
        }

        try {
            const params = {
                message,
                idempotencyKey: crypto.randomUUID()
            };

            if (sessionKey) params.sessionKey = sessionKey;
            if (thinking) params.thinking = thinking;

            const result = await this.manager.client.sendRequest('agent', params);

            if (result && result.response) {
                return `OpenClaw Response:\n${result.response}`;
            }

            return `OpenClaw completed the request.\n${JSON.stringify(result, null, 2)}`;
        } catch (error) {
            return `Error delegating to OpenClaw: ${error.message}`;
        }
    }

    async openclawStatus(_args) {
        if (!this.manager) {
            return "OpenClaw integration is not configured.";
        }

        const status = {
            mode: this.manager.config.mode,
            url: this.manager.config.url,
            clientCreated: !!this.manager.client,
            connected: this.manager.client?.isConnected || false,
            processRunning: !!this.manager.process
        };

        // If connected, try to get health info
        if (status.connected) {
            try {
                const health = await this.manager.client.sendRequest('health', {});
                status.health = health;
            } catch (error) {
                status.healthError = error.message;
            }
        }

        let response = `OpenClaw Integration Status:\n`;
        response += `  Mode: ${status.mode}\n`;
        response += `  URL: ${status.url}\n`;
        response += `  Connected: ${status.connected}\n`;
        response += `  Process Running: ${status.processRunning}\n`;

        if (status.health) {
            response += `  Health: ${JSON.stringify(status.health)}\n`;
        } else if (status.healthError) {
            response += `  Health Check Failed: ${status.healthError}\n`;
        }

        return response;
    }

    async openclawSessions(_args) {
        if (!this.manager || !this.manager.client) {
            return "Error: OpenClaw integration is not available.";
        }

        if (!this.manager.client.isConnected) {
            return "Error: OpenClaw is not connected.";
        }

        try {
            const result = await this.manager.client.sendRequest('sessions.list', {});

            if (!result || !result.sessions || result.sessions.length === 0) {
                return "No active OpenClaw sessions found.";
            }

            let response = `Active OpenClaw Sessions (${result.sessions.length}):\n`;
            for (const session of result.sessions) {
                response += `  - ${session.key || session.id}: ${session.status || 'active'}`;
                if (session.channel) response += ` [${session.channel}]`;
                response += `\n`;
            }

            return response;
        } catch (error) {
            return `Error listing sessions: ${error.message}`;
        }
    }
}
