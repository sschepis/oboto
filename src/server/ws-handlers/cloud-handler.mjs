// Cloud + WebLLM WebSocket Handlers
// Handles all cloud:* and webllm:* message types from the UI.
// ctx.cloudSync may be null if cloud is not configured.

import { wsSend } from '../../lib/ws-utils.mjs';
import { setProviderEnabled } from '../../config.mjs';
import { fetchModelsForProvider } from '../../core/model-registry.mjs';

/** Send a cloud:error to the requesting client */
function sendCloudError(ws, message) {
    wsSend(ws, 'cloud:error', { error: message });
}

export const handlers = {
    // ── WebLLM Response Handler ───────────────────────────────────────────
    'webllm:response': async (data, ctx) => {
        if (ctx.eventBus && data.payload) {
            ctx.eventBus.emitTyped('webllm:response', data.payload);
        }
    },

    'webllm:status': async (data, ctx) => {
        ctx.broadcast('webllm:status', data.payload);
    },

    // ── Auth ──────────────────────────────────────────────────────────────

    'cloud:login': async (data, ctx) => {
        if (!ctx.cloudSync) {
            return wsSend(ctx.ws, 'cloud:login-result', { success: false, configured: false, error: 'Cloud not configured. Set OBOTO_CLOUD_URL and OBOTO_CLOUD_KEY.' });
        }
        try {
            const { email, password } = data.payload || {};
            if (!email || !password) {
                return wsSend(ctx.ws, 'cloud:login-result', { success: false, error: 'Email and password are required' });
            }
            await ctx.cloudSync.login(email, password);
            const status = ctx.cloudSync.getStatus();
            wsSend(ctx.ws, 'cloud:login-result', { success: true, ...status });
            ctx.broadcast('cloud:status', status);

            // Auto-enable the cloud AI provider on successful login
            setProviderEnabled('cloud', true);
            // Fetch cloud models so they appear in the model registry
            fetchModelsForProvider('cloud').catch(err => {
                console.warn(`[cloud-handler] Failed to fetch cloud models after login: ${err.message}`);
                wsSend(ctx.ws, 'cloud:error', { error: `Cloud models couldn't be loaded: ${err.message}. Try refreshing the model list.` });
            });
        } catch (err) {
            wsSend(ctx.ws, 'cloud:login-result', { success: false, error: err.message });
        }
    },

    'cloud:logout': async (data, ctx) => {
        if (!ctx.cloudSync) return;
        try {
            await ctx.cloudSync.logout();
            // Disable the cloud AI provider on logout
            setProviderEnabled('cloud', false);
            ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
        } catch (err) {
            sendCloudError(ctx.ws, `Logout failed: ${err.message}`);
        }
    },

    'cloud:status': async (data, ctx) => {
        let cloudSync = ctx.cloudSync;
        if (!cloudSync && ctx.initCloudSync) {
            cloudSync = await ctx.initCloudSync();
        }
        const status = cloudSync
            ? cloudSync.getStatus()
            : { configured: false, loggedIn: false, user: null, profile: null, org: null, role: null, linkedWorkspace: null, syncState: 'idle' };
        wsSend(ctx.ws, 'cloud:status', status);
    },

    // ── Workspace (Phase 2 stubs) ─────────────────────────────────────────

    'cloud:list-workspaces': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return wsSend(ctx.ws, 'cloud:workspaces', []);
        }
        try {
            const workspaces = await ctx.cloudSync.listCloudWorkspaces();
            wsSend(ctx.ws, 'cloud:workspaces', workspaces || []);
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to list workspaces: ${err.message}`);
        }
    },

    'cloud:link-workspace': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            await ctx.cloudSync.linkWorkspace(data.payload.cloudWorkspaceId);
            ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to link workspace: ${err.message}`);
        }
    },

    'cloud:unlink-workspace': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            await ctx.cloudSync.unlinkWorkspace();
            ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to unlink workspace: ${err.message}`);
        }
    },

    'cloud:sync-push': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            const state = ctx.assistant.workspaceManager.getWorkspaceContext();
            await ctx.cloudSync.pushWorkspaceState(state);
            wsSend(ctx.ws, 'cloud:sync-result', { action: 'push', success: true });
        } catch (err) {
            wsSend(ctx.ws, 'cloud:sync-result', { action: 'push', success: false, error: err.message });
        }
    },

    'cloud:sync-pull': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            const state = await ctx.cloudSync.pullWorkspaceState();
            wsSend(ctx.ws, 'cloud:sync-result', { action: 'pull', success: true, state });
        } catch (err) {
            wsSend(ctx.ws, 'cloud:sync-result', { action: 'pull', success: false, error: err.message });
        }
    },

    // ── Cloud Agents (Phase 3 stubs) ──────────────────────────────────────

    'cloud:list-agents': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return wsSend(ctx.ws, 'cloud:agents', []);
        }
        try {
            const agents = await ctx.cloudSync.listAgents();
            wsSend(ctx.ws, 'cloud:agents', agents || []);
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to list agents: ${err.message}`);
        }
    },

    // ── Workspace Creation ────────────────────────────────────────────────

    'cloud:create-workspace': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { name, description } = data.payload || {};
        if (!name) {
            return sendCloudError(ctx.ws, 'Workspace name is required');
        }
        try {
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const orgId = ctx.cloudSync.auth?.org?.id;
            if (!orgId) throw new Error('No organization found');
            const result = await ctx.cloudSync.client.post('/rest/v1/workspaces', {
                name,
                slug,
                description: description || null,
                org_id: orgId,
                status: 'idle',
                created_by: ctx.cloudSync.auth?.user?.id || null,
            }, { 'Prefer': 'return=representation' });
            const workspace = Array.isArray(result) ? result[0] : result;
            wsSend(ctx.ws, 'cloud:workspace-created', workspace);
            const workspaces = await ctx.cloudSync.listCloudWorkspaces();
            wsSend(ctx.ws, 'cloud:workspaces', workspaces || []);
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to create workspace: ${err.message}`);
        }
    },

    // ── Conversation Sync ─────────────────────────────────────────────────

    'cloud:list-conversations': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return wsSend(ctx.ws, 'cloud:conversations', []);
        }
        try {
            const conversations = await ctx.cloudSync.listCloudConversations();
            wsSend(ctx.ws, 'cloud:conversations', conversations || []);
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to list conversations: ${err.message}`);
        }
    },

    'cloud:push-conversation': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { cloudConvId, lastSyncAt } = data.payload || {};
        if (!cloudConvId) return;
        try {
            const history = ctx.assistant.historyManager.getHistory();
            const result = await ctx.cloudSync.pushConversation(cloudConvId, history, lastSyncAt);
            wsSend(ctx.ws, 'cloud:conversation-sync-result', { action: 'push', ...result });
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to push conversation: ${err.message}`);
        }
    },

    'cloud:pull-conversation': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { cloudConvId, since } = data.payload || {};
        if (!cloudConvId) return;
        try {
            const result = await ctx.cloudSync.pullConversation(cloudConvId, since);
            wsSend(ctx.ws, 'cloud:conversation-sync-result', { action: 'pull', ...result });
            if (result.messages && result.messages.length > 0) {
                for (const msg of result.messages) {
                    ctx.broadcast('message', {
                        id: msg._cloudId || `cloud-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        role: msg.role === 'assistant' ? 'ai' : 'user',
                        type: 'text',
                        content: msg.content,
                        timestamp: new Date().toLocaleTimeString(),
                        isCloud: true,
                    });
                }
            }
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to pull conversation: ${err.message}`);
        }
    },

    // ── Cloud Agents ──────────────────────────────────────────────────────

    'cloud:invoke-agent': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { slug, message, history } = data.payload || {};
        if (!slug || !message) {
            return wsSend(ctx.ws, 'cloud:agent-error', { error: 'Agent slug and message are required', slug });
        }
        try {
            const result = await ctx.cloudSync.invokeAgent(slug, message, history || []);
            wsSend(ctx.ws, 'cloud:agent-response', result);
            ctx.broadcast('message', {
                id: result.messageId || `cloud-agent-${Date.now()}`,
                role: 'ai',
                type: 'text',
                content: `☁️ **${result.agentName}**: ${result.content}`,
                timestamp: new Date().toLocaleTimeString(),
                isCloudAgent: true,
                agentName: result.agentName,
            });
        } catch (err) {
            wsSend(ctx.ws, 'cloud:agent-error', { error: err.message, slug });
        }
    },

    // ── Cloud File Sync ───────────────────────────────────────────────────

    'cloud:list-files': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn() || !ctx.cloudSync.fileSync) {
            return wsSend(ctx.ws, 'cloud:files', []);
        }
        const wsId = ctx.cloudSync.workspaceSync?.getLinkedWorkspaceId();
        if (!wsId) return wsSend(ctx.ws, 'cloud:files', []);
        try {
            const files = await ctx.cloudSync.fileSync.listFiles(wsId);
            wsSend(ctx.ws, 'cloud:files', files);
        } catch (err) {
            sendCloudError(ctx.ws, `List files failed: ${err.message}`);
        }
    },

    'cloud:upload-file': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn() || !ctx.cloudSync.fileSync) return;
        const wsId = ctx.cloudSync.workspaceSync?.getLinkedWorkspaceId();
        if (!wsId) return;
        const { filePath } = data.payload || {};
        if (!filePath) return;
        try {
            const result = await ctx.cloudSync.fileSync.uploadFile(wsId, ctx.assistant.workingDir, filePath);
            wsSend(ctx.ws, 'cloud:file-uploaded', { filePath, ...result });
        } catch (err) {
            sendCloudError(ctx.ws, `Upload failed: ${err.message}`);
        }
    },

    'cloud:download-file': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn() || !ctx.cloudSync.fileSync) return;
        const wsId = ctx.cloudSync.workspaceSync?.getLinkedWorkspaceId();
        if (!wsId) return;
        const { filePath } = data.payload || {};
        if (!filePath) return;
        try {
            const result = await ctx.cloudSync.fileSync.downloadFile(wsId, ctx.assistant.workingDir, filePath);
            wsSend(ctx.ws, 'cloud:file-downloaded', result);
            ctx.broadcastFileTree();
        } catch (err) {
            sendCloudError(ctx.ws, `Download failed: ${err.message}`);
        }
    },

    // ── Cloud Task Execution (run destination) ────────────────────────────

    'cloud:run-task': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { agentSlug, task, history } = data.payload || {};
        if (!agentSlug || !task) {
            return sendCloudError(ctx.ws, 'Agent slug and task message are required');
        }
        try {
            wsSend(ctx.ws, 'cloud:task-started', { agentSlug, task });
            const result = await ctx.cloudSync.invokeAgent(agentSlug, task, history || []);
            wsSend(ctx.ws, 'cloud:task-completed', { agentSlug, ...result });
            ctx.broadcast('message', {
                id: result.messageId || `cloud-task-${Date.now()}`,
                role: 'ai',
                type: 'text',
                content: `☁️ **${result.agentName}** (cloud task): ${result.content}`,
                timestamp: new Date().toLocaleTimeString(),
                isCloudAgent: true,
                agentName: result.agentName,
            });
        } catch (err) {
            wsSend(ctx.ws, 'cloud:task-failed', { agentSlug, error: err.message });
        }
    },

    // ── Cloud AI Provider ──────────────────────────────────────────────────

    'cloud:get-usage': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return wsSend(ctx.ws, 'cloud:usage', { tokens_used: 0, daily_limit: 0, remaining: 0, tier: 'free', period: new Date().toISOString().slice(0, 10), is_unlimited: false });
        }
        try {
            const usage = await ctx.cloudSync.getUsage();
            wsSend(ctx.ws, 'cloud:usage', usage);
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to get usage: ${err.message}`);
        }
    },

    'cloud:list-models': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return wsSend(ctx.ws, 'cloud:models', []);
        }
        try {
            const models = await ctx.cloudSync.listCloudModels();
            wsSend(ctx.ws, 'cloud:models', models || []);
        } catch (err) {
            sendCloudError(ctx.ws, `Failed to list cloud models: ${err.message}`);
        }
    },
};
