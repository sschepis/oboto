/**
 * Secret Handlers — implements the blocking request/resolve pattern for the
 * `request_secret` AI tool.
 *
 * When the AI calls `request_secret`, the handler emits a `secret:request`
 * event on the EventBus and returns a Promise that blocks until the user
 * provides the secret (or the request times out / is cancelled).
 *
 * The secret value NEVER passes through this handler — only the resolution
 * status (success / cancelled / timeout) is returned to the AI.
 */

import { consoleStyler } from '../../ui/console-styler.mjs';

export class SecretHandlers {
    /**
     * @param {import('../../core/eventic-facade.mjs').EventicFacade} eventBus
     */
    constructor(eventBus) {
        this.eventBus = eventBus;
        /** @type {Map<string, { resolve: Function, timeout: ReturnType<typeof setTimeout>, name: string }>} */
        this.pendingRequests = new Map();
    }

    /**
     * Request a secret from the user.
     * Emits `secret:request` on the EventBus and blocks until the user
     * provides the secret, cancels, or the request times out.
     *
     * @param {Object} args
     * @param {string} args.name        - Environment variable name (e.g. OPENAI_API_KEY)
     * @param {string} args.label       - Human-readable label (e.g. "OpenAI API Key")
     * @param {string} [args.description] - Optional explanation of why the secret is needed
     * @returns {Promise<string>} Result message (never contains the secret value)
     */
    async requestSecret(args) {
        const { name, label, description } = args;

        if (!this.eventBus) {
            return '[error] request_secret: Event bus is not available. Cannot request secrets.';
        }

        if (!name || !label) {
            return '[error] request_secret: Both "name" and "label" parameters are required.';
        }

        const requestId = `secret-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        consoleStyler.log('system', `🔐 Secret requested: ${name} (${label}) — waiting for user input…`);

        return new Promise((resolve) => {
            // 10-minute timeout
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                consoleStyler.log('warning', `🔐 Secret request timed out: ${name}`);
                resolve(`Secret request for '${name}' timed out after 10 minutes.`);
            }, 600_000);

            this.pendingRequests.set(requestId, { resolve, timeout, name });

            // Emit the request to the EventBus → EventBroadcaster → WebSocket → UI
            this.eventBus.emit('secret:request', {
                requestId,
                name,
                label,
                description: description || ''
            });
        });
    }

    /**
     * Resolve a pending secret request.
     * Called by the WS handler when the user submits or cancels.
     *
     * @param {string} requestId - The request ID to resolve
     * @param {boolean} success  - Whether the secret was provided (true) or cancelled (false)
     * @returns {boolean} Whether a pending request was found and resolved
     */
    resolveSecretRequest(requestId, success) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            consoleStyler.log('warning', `🔐 No pending secret request found for ID: ${requestId}`);
            return false;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);

        if (success) {
            consoleStyler.log('system', `🔐 Secret provided: ${pending.name}`);
            pending.resolve(
                `Secret '${pending.name}' has been stored in the workspace .env file. ` +
                `The value is securely stored and not visible to the AI.`
            );
        } else {
            consoleStyler.log('system', `🔐 Secret request cancelled: ${pending.name}`);
            pending.resolve(`User declined to provide the secret '${pending.name}'.`);
        }

        return true;
    }

    /**
     * Clean up all pending requests (e.g. on workspace switch or shutdown).
     */
    cleanup() {
        for (const [requestId, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.resolve(`Secret request for '${pending.name}' was cancelled due to shutdown.`);
        }
        this.pendingRequests.clear();
    }
}
