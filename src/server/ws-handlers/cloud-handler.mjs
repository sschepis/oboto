// Cloud + WebLLM WebSocket Handlers
// Handles all cloud:* and webllm:* message types from the UI.
// ctx.cloudSync may be null if cloud is not configured.

export const handlers = {
    // ── WebLLM Response Handler ───────────────────────────────────────────
    // The browser runs the model via @mlc-ai/web-llm and sends results back
    'webllm:response': async (data, ctx) => {
        if (ctx.eventBus && data.payload) {
            ctx.eventBus.emitTyped('webllm:response', data.payload);
        }
    },

    'webllm:status': async (data, ctx) => {
        // Broadcast WebLLM engine status to all clients
        ctx.broadcast('webllm:status', data.payload);
    },

    // ── Auth ──────────────────────────────────────────────────────────────

    'cloud:login': async (data, ctx) => {
        if (!ctx.cloudSync) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:login-result',
                payload: { success: false, configured: false, error: 'Cloud not configured. Set OBOTO_CLOUD_URL and OBOTO_CLOUD_KEY.' }
            }));
        }
        try {
            const { email, password } = data.payload || {};
            if (!email || !password) {
                return ctx.ws.send(JSON.stringify({
                    type: 'cloud:login-result',
                    payload: { success: false, error: 'Email and password are required' }
                }));
            }
            await ctx.cloudSync.login(email, password);
            const status = ctx.cloudSync.getStatus();
            ctx.ws.send(JSON.stringify({
                type: 'cloud:login-result',
                payload: { success: true, ...status }
            }));
            // Broadcast to all clients that cloud state changed
            ctx.broadcast('cloud:status', status);
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:login-result',
                payload: { success: false, error: err.message }
            }));
        }
    },

    'cloud:logout': async (data, ctx) => {
        if (!ctx.cloudSync) return;
        try {
            await ctx.cloudSync.logout();
            ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Logout failed: ${err.message}` }
            }));
        }
    },

    'cloud:status': async (data, ctx) => {
        const status = ctx.cloudSync
            ? ctx.cloudSync.getStatus()
            : { configured: false, loggedIn: false, user: null, profile: null, org: null, role: null, linkedWorkspace: null, syncState: 'idle' };
        ctx.ws.send(JSON.stringify({
            type: 'cloud:status',
            payload: status
        }));
    },

    // ── Workspace (Phase 2 stubs) ─────────────────────────────────────────

    'cloud:list-workspaces': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:workspaces',
                payload: []
            }));
        }
        try {
            const workspaces = await ctx.cloudSync.listCloudWorkspaces();
            ctx.ws.send(JSON.stringify({
                type: 'cloud:workspaces',
                payload: workspaces || []
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to list workspaces: ${err.message}` }
            }));
        }
    },

    'cloud:link-workspace': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            await ctx.cloudSync.linkWorkspace(data.payload.cloudWorkspaceId);
            ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to link workspace: ${err.message}` }
            }));
        }
    },

    'cloud:unlink-workspace': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            await ctx.cloudSync.unlinkWorkspace();
            ctx.broadcast('cloud:status', ctx.cloudSync.getStatus());
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to unlink workspace: ${err.message}` }
            }));
        }
    },

    'cloud:sync-push': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            const state = ctx.assistant.workspaceManager.getWorkspaceContext();
            await ctx.cloudSync.pushWorkspaceState(state);
            ctx.ws.send(JSON.stringify({
                type: 'cloud:sync-result',
                payload: { action: 'push', success: true }
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:sync-result',
                payload: { action: 'push', success: false, error: err.message }
            }));
        }
    },

    'cloud:sync-pull': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        try {
            const state = await ctx.cloudSync.pullWorkspaceState();
            ctx.ws.send(JSON.stringify({
                type: 'cloud:sync-result',
                payload: { action: 'pull', success: true, state }
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:sync-result',
                payload: { action: 'pull', success: false, error: err.message }
            }));
        }
    },

    // ── Cloud Agents (Phase 3 stubs) ──────────────────────────────────────

    'cloud:list-agents': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:agents',
                payload: []
            }));
        }
        try {
            const agents = await ctx.cloudSync.listAgents();
            ctx.ws.send(JSON.stringify({
                type: 'cloud:agents',
                payload: agents || []
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to list agents: ${err.message}` }
            }));
        }
    },

    // ── Workspace Creation ────────────────────────────────────────────────

    'cloud:create-workspace': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { name, description } = data.payload || {};
        if (!name) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: 'Workspace name is required' }
            }));
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
            ctx.ws.send(JSON.stringify({
                type: 'cloud:workspace-created',
                payload: workspace
            }));
            // Refresh workspace list
            const workspaces = await ctx.cloudSync.listCloudWorkspaces();
            ctx.ws.send(JSON.stringify({
                type: 'cloud:workspaces',
                payload: workspaces || []
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to create workspace: ${err.message}` }
            }));
        }
    },

    // ── Conversation Sync ─────────────────────────────────────────────────

    'cloud:list-conversations': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:conversations',
                payload: []
            }));
        }
        try {
            const conversations = await ctx.cloudSync.listCloudConversations();
            ctx.ws.send(JSON.stringify({
                type: 'cloud:conversations',
                payload: conversations || []
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to list conversations: ${err.message}` }
            }));
        }
    },

    'cloud:push-conversation': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { cloudConvId, lastSyncAt } = data.payload || {};
        if (!cloudConvId) return;
        try {
            const history = ctx.assistant.historyManager.getHistory();
            const result = await ctx.cloudSync.pushConversation(cloudConvId, history, lastSyncAt);
            ctx.ws.send(JSON.stringify({
                type: 'cloud:conversation-sync-result',
                payload: { action: 'push', ...result }
            }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to push conversation: ${err.message}` }
            }));
        }
    },

    'cloud:pull-conversation': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { cloudConvId, since } = data.payload || {};
        if (!cloudConvId) return;
        try {
            const result = await ctx.cloudSync.pullConversation(cloudConvId, since);
            ctx.ws.send(JSON.stringify({
                type: 'cloud:conversation-sync-result',
                payload: { action: 'pull', ...result }
            }));
            // Broadcast new messages from cloud as chat messages
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
            ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: `Failed to pull conversation: ${err.message}` }
            }));
        }
    },

    // ── Cloud Agents ──────────────────────────────────────────────────────

    'cloud:invoke-agent': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { slug, message, history } = data.payload || {};
        if (!slug || !message) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:agent-error',
                payload: { error: 'Agent slug and message are required', slug }
            }));
        }
        try {
            const result = await ctx.cloudSync.invokeAgent(slug, message, history || []);
            ctx.ws.send(JSON.stringify({
                type: 'cloud:agent-response',
                payload: result
            }));
            // Also broadcast as a chat message so it appears in conversation
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
            ctx.ws.send(JSON.stringify({
                type: 'cloud:agent-error',
                payload: { error: err.message, slug }
            }));
        }
    },

    // ── Cloud File Sync ───────────────────────────────────────────────────

    'cloud:list-files': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn() || !ctx.cloudSync.fileSync) {
            return ctx.ws.send(JSON.stringify({ type: 'cloud:files', payload: [] }));
        }
        const wsId = ctx.cloudSync.workspaceSync?.getLinkedWorkspaceId();
        if (!wsId) return ctx.ws.send(JSON.stringify({ type: 'cloud:files', payload: [] }));
        try {
            const files = await ctx.cloudSync.fileSync.listFiles(wsId);
            ctx.ws.send(JSON.stringify({ type: 'cloud:files', payload: files }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({ type: 'cloud:error', payload: { error: `List files failed: ${err.message}` } }));
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
            ctx.ws.send(JSON.stringify({ type: 'cloud:file-uploaded', payload: { filePath, ...result } }));
        } catch (err) {
            ctx.ws.send(JSON.stringify({ type: 'cloud:error', payload: { error: `Upload failed: ${err.message}` } }));
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
            ctx.ws.send(JSON.stringify({ type: 'cloud:file-downloaded', payload: result }));
            ctx.broadcastFileTree();
        } catch (err) {
            ctx.ws.send(JSON.stringify({ type: 'cloud:error', payload: { error: `Download failed: ${err.message}` } }));
        }
    },

    // ── Cloud Task Execution (run destination) ────────────────────────────

    'cloud:run-task': async (data, ctx) => {
        if (!ctx.cloudSync?.isLoggedIn()) return;
        const { agentSlug, task, history } = data.payload || {};
        if (!agentSlug || !task) {
            return ctx.ws.send(JSON.stringify({
                type: 'cloud:error',
                payload: { error: 'Agent slug and task message are required' }
            }));
        }
        try {
            ctx.ws.send(JSON.stringify({
                type: 'cloud:task-started',
                payload: { agentSlug, task }
            }));
            const result = await ctx.cloudSync.invokeAgent(agentSlug, task, history || []);
            ctx.ws.send(JSON.stringify({
                type: 'cloud:task-completed',
                payload: { agentSlug, ...result }
            }));
            // Broadcast result as chat message
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
            ctx.ws.send(JSON.stringify({
                type: 'cloud:task-failed',
                payload: { agentSlug, error: err.message }
            }));
        }
    },
};
