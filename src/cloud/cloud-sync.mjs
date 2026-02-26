// CloudSync — Top-level orchestrator for Oboto Cloud integration
// Registered as 'cloudSync' in ServiceRegistry. May be null when cloud is not configured.
// All methods are safe to call even when not logged in — they return early with defaults.

import { CloudClient } from './cloud-client.mjs';
import { CloudAuth } from './cloud-auth.mjs';
import { CloudWorkspaceSync } from './cloud-workspace-sync.mjs';
import { CloudConversationSync } from './cloud-conversation-sync.mjs';
import { CloudAgent } from './cloud-agent.mjs';
import { CloudRealtime } from './cloud-realtime.mjs';
import { CloudFileSync } from './cloud-file-sync.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * CloudSync is the single entry point for all cloud features.
 * It owns the CloudClient and CloudAuth, and will later own
 * CloudWorkspaceSync, CloudConversationSync, CloudAgent, and CloudRealtime.
 *
 * Lifecycle:
 *   1. initialize(config) — creates CloudClient + CloudAuth
 *   2. login(email, password) — authenticates user
 *   3. logout() — tears down cloud state
 *   4. destroy() — full cleanup on server shutdown
 */
export class CloudSync {
    /**
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     * @param {import('../server/secrets-manager.mjs').SecretsManager} secretsManager
     */
    constructor(eventBus, secretsManager) {
        this.eventBus = eventBus;
        this.secretsManager = secretsManager;

        /** @type {CloudClient|null} */
        this.client = null;

        /** @type {CloudAuth|null} */
        this.auth = null;

        /** @type {CloudWorkspaceSync|null} */
        this.workspaceSync = null;

        /** @type {CloudConversationSync|null} */
        this.conversationSync = null;

        /** @type {CloudAgent|null} */
        this.agent = null;

        /** @type {CloudRealtime|null} */
        this.realtime = null;

        /** @type {CloudFileSync|null} */
        this.fileSync = null;

        /** @type {string|null} Local working directory */
        this._workingDir = null;

        /** @type {object|null} */
        this._config = null;

        /** @type {ReturnType<typeof setInterval>|null} */
        this._syncTimer = null;

        /** @type {ReturnType<typeof setInterval>|null} */
        this._presenceTimer = null;

        /** @type {number} Consecutive usage fetch failures — suppresses repeated log spam */
        this._usageFailCount = 0;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /**
     * Initialize the cloud module with configuration.
     * Creates CloudClient and CloudAuth but does NOT log in.
     * @param {object} config — from loadCloudConfig()
     */
    async initialize(config) {
        this._config = config;
        this.client = new CloudClient(config.baseUrl, config.anonKey);
        this.auth = new CloudAuth(this.client, this.eventBus, this.secretsManager);
    }

    /**
     * Login with email and password.
     * @param {string} email
     * @param {string} password
     * @returns {Promise<void>}
     */
    async login(email, password) {
        if (!this.auth) throw new Error('Cloud not initialized');
        await this.auth.login(email, password);
        this._createSubModules();
        await this._tryLoadWorkspaceLink();
        this._startAutoSync();
    }

    /**
     * Try auto-login from cached refresh token. Silent, never throws.
     * @returns {Promise<boolean>}
     */
    async tryAutoLogin() {
        if (!this.auth || !this._config?.autoLogin) return false;
        const success = await this.auth.tryAutoLogin();
        if (success) {
            this._createSubModules();
            await this._tryLoadWorkspaceLink();
            this._startAutoSync();
        }
        return success;
    }

    /**
     * Logout: tear down all cloud state, stop timers.
     * @returns {Promise<void>}
     */
    async logout() {
        this._stopAutoSync();
        if (this.realtime) {
            this.realtime.disconnect();
            this.realtime = null;
        }
        this.workspaceSync = null;
        this.conversationSync = null;
        this.agent = null;
        if (this.auth) {
            await this.auth.logout();
        }
    }

    /**
     * Set the local working directory (called from main.mjs or on workspace switch).
     * @param {string} dir
     */
    setWorkingDir(dir) {
        this._workingDir = dir;
    }

    /**
     * Create sub-modules after successful authentication.
     */
    _createSubModules() {
        if (!this.client) return;
        this.workspaceSync = new CloudWorkspaceSync(this.client, this.eventBus);
        this.conversationSync = new CloudConversationSync(this.client, this.eventBus);
        this.agent = new CloudAgent(this.client, this.eventBus);
        this.fileSync = new CloudFileSync(this.client, this.eventBus);
        this.realtime = new CloudRealtime(
            this._config.baseUrl,
            this._config.anonKey,
            this.client.accessToken,
            this.eventBus
        );

        // Propagate token refreshes to realtime WebSocket
        if (this.eventBus) {
            this.eventBus.on('cloud:auth:logged-in', () => {
                if (this.realtime && this.client?.accessToken) {
                    this.realtime.updateAccessToken(this.client.accessToken);
                }
            });
        }
    }

    /**
     * Try to load an existing workspace link from .cloud-link.json.
     */
    async _tryLoadWorkspaceLink() {
        if (!this.workspaceSync || !this._workingDir) return;
        await this.workspaceSync.loadLink(this._workingDir);
    }

    /**
     * Full cleanup on server shutdown.
     * @returns {Promise<void>}
     */
    async destroy() {
        await this.logout();
        this.client = null;
        this.auth = null;
        this._config = null;
    }

    // ── Status ────────────────────────────────────────────────────────────

    /**
     * Whether cloud is configured (URL + key provided).
     * @returns {boolean}
     */
    isConfigured() {
        return !!this._config;
    }

    /**
     * Whether the user is logged in.
     * @returns {boolean}
     */
    isLoggedIn() {
        return this.auth?.isLoggedIn() || false;
    }

    /**
     * Get a full status snapshot for reporting to the UI.
     * @returns {object}
     */
    getStatus() {
        const linkData = this.workspaceSync?.getLinkData();
        return {
            configured: this.isConfigured(),
            ...(this.auth ? this.auth.getSnapshot() : { loggedIn: false, user: null, profile: null, org: null, role: null }),
            linkedWorkspace: linkData
                ? { id: linkData.cloudWorkspaceId, name: linkData.cloudWorkspaceName }
                : null,
            syncState: this._syncTimer ? 'synced' : 'idle',
        };
    }

    // ── Workspace Sync ────────────────────────────────────────────────────

    /**
     * Link the local workspace to a cloud workspace.
     * @param {string} cloudWorkspaceId
     * @param {string} [cloudWorkspaceName]
     */
    async linkWorkspace(cloudWorkspaceId, cloudWorkspaceName = '') {
        if (!this.workspaceSync || !this._workingDir) return;
        await this.workspaceSync.link(this._workingDir, cloudWorkspaceId, cloudWorkspaceName);
        this._startAutoSync();
    }

    /**
     * Unlink the local workspace from cloud.
     */
    async unlinkWorkspace() {
        this._stopAutoSync();
        if (!this.workspaceSync || !this._workingDir) return;
        await this.workspaceSync.unlink(this._workingDir);
    }

    /**
     * Push local workspace state to the linked cloud workspace.
     * @param {object} localState — from WorkspaceManager.getWorkspaceContext()
     */
    async pushWorkspaceState(localState) {
        if (!this.workspaceSync) return null;
        const wsId = this.workspaceSync.getLinkedWorkspaceId();
        if (!wsId) return null;
        const result = await this.workspaceSync.push(wsId, localState);
        if (this._workingDir) await this.workspaceSync.saveLinkData(this._workingDir);
        return result;
    }

    /**
     * Pull cloud workspace state for the linked workspace.
     */
    async pullWorkspaceState() {
        if (!this.workspaceSync) return null;
        const wsId = this.workspaceSync.getLinkedWorkspaceId();
        if (!wsId) return null;
        const state = await this.workspaceSync.pull(wsId);
        if (this._workingDir) await this.workspaceSync.saveLinkData(this._workingDir);
        return state;
    }

    /**
     * List available cloud workspaces for the user's org.
     */
    async listCloudWorkspaces() {
        if (!this.workspaceSync || !this.auth?.org) return [];
        return this.workspaceSync.listCloudWorkspaces(this.auth.org.id);
    }

    // ── Conversation Sync ─────────────────────────────────────────────────

    /**
     * Push messages from a local conversation to a cloud conversation.
     * @param {string} cloudConvId — Cloud conversation UUID
     * @param {Array} messages — Local message history
     * @param {string|null} lastSyncAt — From link data
     */
    async pushConversation(cloudConvId, messages, lastSyncAt = null) {
        if (!this.conversationSync) return { pushed: 0 };
        const userId = this.auth?.user?.id || null;
        return this.conversationSync.pushMessages(cloudConvId, messages, lastSyncAt, userId);
    }

    /**
     * Pull new messages from a cloud conversation.
     * @param {string} cloudConvId
     * @param {string|null} since
     */
    async pullConversation(cloudConvId, since = null) {
        if (!this.conversationSync) return { messages: [] };
        const userId = this.auth?.user?.id || null;
        return this.conversationSync.pullMessages(cloudConvId, since, userId);
    }

    /**
     * List cloud conversations for the linked workspace.
     */
    async listCloudConversations() {
        if (!this.conversationSync) return [];
        const wsId = this.workspaceSync?.getLinkedWorkspaceId();
        if (!wsId) return [];
        return this.conversationSync.listCloudConversations(wsId);
    }

    // ── Cloud Agents ──────────────────────────────────────────────────────

    /**
     * List cloud agents available in the user's org.
     * @returns {Promise<Array>}
     */
    async listAgents() {
        if (!this.agent || !this.isLoggedIn() || !this.auth?.org) return [];
        return this.agent.listAgents(this.auth.org.id);
    }

    /**
     * Invoke a cloud agent by slug.
     * @param {string} slug — Agent slug (e.g. "code-reviewer")
     * @param {string} message — User message
     * @param {Array} history — Recent message history for context
     * @returns {Promise<{ content: string, messageId: string, agentName: string }>}
     */
    async invokeAgent(slug, message, history = []) {
        if (!this.agent || !this.isLoggedIn()) throw new Error('Not logged in to cloud');
        return this.agent.invoke(slug, null, message, history);
    }

    // ── Cloud Models & Usage ─────────────────────────────────────────────

    /**
     * Fetch the list of AI models available through the cloud AI gateway.
     * Returns models appropriate for the user's subscription tier.
     * @returns {Promise<Array<{ id: string, display_name: string, context_window: number, max_output_tokens: number, supports_tool_calling: boolean, supports_streaming: boolean, cost_tier: string, reasoning: string, tier_required: string }>>}
     */
    async listCloudModels() {
        if (!this.isLoggedIn() || !this.client) return [];
        try {
            const result = await this.client.get('/functions/v1/cloud-models');
            return result?.models || [];
        } catch (err) {
            consoleStyler.log('cloud', `Failed to fetch cloud models: ${err.message}`);
            return [];
        }
    }

    /**
     * Get current AI usage data for the logged-in user.
     * Returns today's token usage, daily limit, and tier info.
     * System admin users (role: owner or admin) get unlimited tokens.
     * @returns {Promise<{ today: { tokens_used: number, tokens_limit: number, request_count: number, models_used: object }, tier: string, subscription_status: string, is_unlimited: boolean } | null>}
     */
    async getUsage() {
        if (!this.isLoggedIn() || !this.client) return null;
        try {
            const usage = await this.client.get('/functions/v1/cloud-usage');
            // System admin users (owner/admin) get unlimited tokens
            const role = this.auth?.membership?.role;
            const isAdmin = role === 'owner' || role === 'admin';
            if (usage) {
                usage.is_unlimited = isAdmin;
            }
            // Reset failure counter on success
            this._usageFailCount = 0;
            return usage;
        } catch (err) {
            this._usageFailCount++;
            // Only log the first failure and every 50th thereafter to avoid spam
            if (this._usageFailCount === 1) {
                consoleStyler.log('cloud', `Failed to fetch usage: ${err.message}`);
            } else if (this._usageFailCount % 50 === 0) {
                consoleStyler.log('cloud', `Failed to fetch usage (${this._usageFailCount} consecutive failures): ${err.message}`);
            }
            return null;
        }
    }

    // ── AI Proxy ──────────────────────────────────────────────────────────

    /**
     * Route an AI completion request through the cloud proxy.
     * Uses the ai-proxy Edge Function for metered model access.
     *
     * @param {string} provider — AI provider (or 'auto' to let cloud decide)
     * @param {string} model — Model ID
     * @param {Array<{ role: string, content: string }>} messages — Chat messages
     * @param {object} [options] — Additional request options
     * @param {Array} [options.tools] — Tool definitions for function calling
     * @param {number} [options.temperature] — Sampling temperature
     * @param {number} [options.max_tokens] — Max output tokens
     * @param {object} [options.response_format] — Response format specification
     * @returns {Promise<object>} OpenAI-compatible completion response
     */
    async aiProxyRequest(provider, model, messages, options = {}) {
        if (!this.isLoggedIn() || !this.client) {
            throw new Error('Cloud AI proxy requires an active cloud login');
        }

        const wsId = this.workspaceSync?.getLinkedWorkspaceId() || null;

        const body = {
            provider: provider || 'auto',
            model,
            messages,
            // Streaming is explicitly disabled for cloud proxy requests.
            // The cloud edge function returns a complete response; streaming
            // support would require a different transport (e.g. SSE or chunked).
            stream: false,
            workspace_id: wsId,
        };

        // Forward optional parameters if provided
        if (options.tools && options.tools.length > 0) body.tools = options.tools;
        if (options.temperature !== undefined) body.temperature = options.temperature;
        if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
        if (options.response_format) body.response_format = options.response_format;

        return this.client.post('/functions/v1/ai-proxy', body);
    }

    /**
     * Route an AI completion request through the cloud proxy with streaming.
     * Returns an async generator yielding SSE chunks.
     *
     * @param {string} model — Model ID
     * @param {Array<{ role: string, content: string }>} messages
     * @returns {AsyncGenerator<object>} SSE data chunks
     */
    async *aiProxyStream(model, messages) {
        if (!this.isLoggedIn() || !this.client) {
            throw new Error('Cloud AI proxy requires an active cloud login');
        }

        const wsId = this.workspaceSync?.getLinkedWorkspaceId() || null;

        yield* this.client.stream('/functions/v1/ai-proxy', {
            provider: 'auto',
            model,
            messages,
            stream: true,
            workspace_id: wsId,
        });
    }

    // ── Auto-sync Timer ───────────────────────────────────────────────────

    _startAutoSync() {
        this._stopAutoSync();

        const wsId = this.workspaceSync?.getLinkedWorkspaceId();
        if (!wsId) return;

        // Connect realtime WebSocket and subscribe to workspace changes
        if (this.realtime && !this.realtime.isConnected()) {
            this.realtime.connect()
                .then(() => {
                    this.realtime.subscribeToWorkspace(wsId, (record) => {
                        if (this.eventBus) {
                            this.eventBus.emitTyped('cloud:workspace:remote-update', record);
                        }
                    });
                    // Join presence channel
                    if (this.auth?.user && this.auth?.profile) {
                        this.realtime.joinPresence(wsId, {
                            user_id: this.auth.user.id,
                            display_name: this.auth.profile.display_name || this.auth.user.email,
                            avatar_url: this.auth.profile.avatar_url || null,
                            status: 'active',
                            connected_from: 'desktop',
                        }, (presencePayload) => {
                            if (this.eventBus) {
                                this.eventBus.emitTyped('cloud:presence:updated', presencePayload);
                            }
                        });
                    }
                })
                .catch(err => {
                    consoleStyler.log('cloud', `Realtime connection failed: ${err.message}`);
                });
        }

        const interval = this._config?.syncInterval || 30000;

        this._syncTimer = setInterval(async () => {
            try {
                await this.pullWorkspaceState();
                if (this.eventBus) {
                    this.eventBus.emitTyped('cloud:sync-status', { state: 'synced' });
                }
            } catch (err) {
                if (this.eventBus) {
                    this.eventBus.emitTyped('cloud:sync-status', { state: 'error', error: err.message });
                }
            }
        }, interval);

        // Don't keep the process alive for sync
        if (this._syncTimer.unref) this._syncTimer.unref();
    }

    _stopAutoSync() {
        if (this._syncTimer) {
            clearInterval(this._syncTimer);
            this._syncTimer = null;
        }
        if (this._presenceTimer) {
            clearInterval(this._presenceTimer);
            this._presenceTimer = null;
        }
    }
}
