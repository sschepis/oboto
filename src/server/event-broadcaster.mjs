import { consoleStyler } from '../ui/console-styler.mjs';
import { convertHistoryToUIMessages, getDirectoryTree } from './ws-helpers.mjs';
import { isLLMAuthError, buildLLMAuthErrorPayload } from './llm-error-detector.mjs';

export class EventBroadcaster {
    constructor(wss, eventBus, assistant, agentLoopController) {
        this.wss = wss;
        this.eventBus = eventBus;
        this.assistant = assistant;
        this.agentLoopController = agentLoopController;

        // Bind methods to ensure 'this' context is preserved when passed around
        this.broadcast = this.broadcast.bind(this);
        this.broadcastFileTree = this.broadcastFileTree.bind(this);

        /** @type {Array<{event: string, handler: Function}>} */
        this._listeners = [];
    }

    initialize() {
        this.setupSubscriptions();
    }

    /**
     * Remove all event listeners registered by this broadcaster.
     * Call this before re-initializing or during shutdown to prevent
     * duplicate broadcasts from leaked listeners.
     * Also nulls out held references so the broadcaster doesn't keep
     * large objects alive via GC roots after shutdown.
     */
    destroy() {
        if (this.eventBus && this._listeners.length > 0) {
            for (const { event, handler } of this._listeners) {
                this.eventBus.off(event, handler);
            }
        }
        this._listeners = [];
        this.wss = null;
        this.eventBus = null;
        this.assistant = null;
        this.agentLoopController = null;
    }

    /**
     * Broadcast a message to all connected clients.
     * Serializes once to avoid redundant JSON.stringify per client and
     * guards against payloads that cannot be serialized (circular refs, BigInt).
     * @param {string} type - The message type.
     * @param {any} payload - The message payload.
     */
    broadcast(type, payload) {
        if (!this.wss) return; // destroyed
        let msg;
        try {
            msg = JSON.stringify({ type, payload });
        } catch (e) {
            consoleStyler.log('warning', `broadcast: failed to serialize "${type}" payload — ${e.message}`);
            return;
        }
        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(msg);
            }
        });
    }

    /**
     * Helper to broadcast file tree updates to all clients.
     */
    async broadcastFileTree() {
        if (!this.wss || !this.assistant) return; // destroyed
        try {
            const tree = await getDirectoryTree(this.assistant.workingDir, 2);
            this.broadcast('file-tree', tree);
        } catch (e) {
            consoleStyler.log('error', `Failed to broadcast file tree: ${e.message}`);
        }
    }

    /**
     * Register an event listener and track it for cleanup via destroy().
     * @param {string} event
     * @param {Function} handler
     */
    _on(event, handler) {
        this.eventBus.on(event, handler);
        this._listeners.push({ event, handler });
    }

    setupSubscriptions() {
        if (!this.eventBus) return;

        const broadcast = this.broadcast;

        this._on('server:log', (data) => broadcast('log', data));
        this._on('server:progress', (data) => broadcast('progress', data));
        // High-level facade operations (ai_man_chat, ai_man_execute, etc.)
        // emitted by ServerStatusAdapter
        this._on('server:tool-start', (data) => broadcast('tool-start', data));
        this._on('server:tool-end', (data) => broadcast('tool-end', data));

        // Individual tool-call events emitted by ToolExecutor
        this._on('server:tool-call-start', (data) => broadcast('tool-call-start', data));
        this._on('server:tool-call-end', (data) => {
            broadcast('tool-call-end', data);
            
            // Auto-refresh file tree if tool was a file system mutation
            if (data.toolName && (
                data.toolName === 'write_to_file' || 
                data.toolName === 'write_file' ||
                data.toolName === 'write_many_files' ||
                data.toolName === 'delete_file' || 
                data.toolName === 'apply_diff' || 
                data.toolName === 'edit_file' || 
                data.toolName === 'create_directory' || 
                data.toolName === 'move_file' ||
                data.toolName === 'bootstrap_project' || 
                data.toolName.startsWith('mcp_filesystem_')
            )) {
                this.broadcastFileTree();
            }
        });
        this._on('server:next-steps', (data) => broadcast('next-steps', data));
        this._on('server:history-loaded', (data) => {
            const uiMessages = convertHistoryToUIMessages(data);
            broadcast('history-loaded', uiMessages);
        });

        // Task Lifecycle Events
        this._on('task:spawned', (data) => broadcast('task-spawned', data));
        this._on('task:started', (data) => broadcast('task-started', data));
        this._on('task:progress', (data) => broadcast('task-progress', data));
        this._on('task:output', (data) => broadcast('task-output', data));
        this._on('task:completed', (data) => broadcast('task-completed', data));
        this._on('task:failed', (data) => {
            broadcast('task-failed', data);
            // Detect LLM auth errors from background tasks (agent loop, scheduled tasks)
            // and broadcast the llm-auth-error event to redirect users to secrets config
            const errorMsg = data.error || data.message || '';
            if (isLLMAuthError(errorMsg)) {
                const payload = buildLLMAuthErrorPayload(errorMsg, data.taskId ? 'agent-loop' : 'task');
                broadcast('llm-auth-error', payload);
                consoleStyler.log('error', `LLM auth error detected in background task — broadcasting secrets redirect`);
                // Stop the agent loop to prevent repeated failures
                if (this.agentLoopController && this.agentLoopController.state === 'playing') {
                    this.agentLoopController.stop();
                    consoleStyler.log('system', '⏹ Agent loop stopped due to LLM auth error');
                }
            }
        });
        this._on('task:cancelled', (data) => broadcast('task-cancelled', data));

        // Workspace Task Events
        this._on('workspace-task:spawned', (data) => broadcast('workspace-task-spawned', data));
        this._on('workspace-task:completed', (data) => {
            broadcast('workspace-task-completed', data);
            // Also inject a system message into the originating chat so the user sees the result
            if (data.result) {
                broadcast('message', {
                    id: `ws-task-result-${Date.now()}`,
                    role: 'ai',
                    type: 'system',
                    content: `📋 **Workspace Task Completed**\n\n**Task:** ${data.description || data.taskId}\n**Workspace:** ${data.workspacePath}\n\n${data.result}`,
                    timestamp: new Date().toLocaleString(),
                    isWorkspaceTask: true,
                    taskId: data.taskId,
                    workspacePath: data.workspacePath,
                });
            }
        });
        this._on('workspace-task:failed', (data) => {
            broadcast('workspace-task-failed', data);
            broadcast('message', {
                id: `ws-task-fail-${Date.now()}`,
                role: 'ai',
                type: 'system',
                content: `❌ **Workspace Task Failed**\n\n**Task:** ${data.description || data.taskId}\n**Workspace:** ${data.workspacePath}\n**Error:** ${data.error}`,
                timestamp: new Date().toLocaleString(),
                isWorkspaceTask: true,
                taskId: data.taskId,
                workspacePath: data.workspacePath,
            });
        });

        // Schedule Events
        this._on('schedule:created', (data) => broadcast('schedule-created', data));
        this._on('schedule:paused', (data) => broadcast('schedule-paused', data));
        this._on('schedule:resumed', (data) => broadcast('schedule-resumed', data));
        this._on('schedule:deleted', (data) => broadcast('schedule-deleted', data));
        this._on('schedule:fired', (data) => broadcast('schedule-fired', data));

        // Surface Events
        this._on('surface:created', (data) => broadcast('surface-created', data));
        this._on('surface:updated', (data) => broadcast('surface-updated', data));
        this._on('surface:deleted', (data) => broadcast('surface-deleted', data));
        this._on('surface:opened', (data) => broadcast('surface-opened', data));
        this._on('surface:layout-updated', (data) => broadcast('surface-layout-updated', data));
        this._on('surface:request-screenshot', (data) => broadcast('request-screenshot', data));

        // UI Style Events
        this._on('ui-style:theme', (data) => broadcast('ui-style-theme', data));
        this._on('ui-style:tokens', (data) => broadcast('ui-style-tokens', data));
        this._on('ui-style:css', (data) => broadcast('ui-style-css', data));
        this._on('ui-style:reset', (data) => broadcast('ui-style-reset', data));
        this._on('ui-display-names', (data) => broadcast('ui-display-names', data));

        // Workflow Events (BubbleLab integration)
        this._on('workflow:started', (data) => broadcast('workflow-started', data));
        this._on('workflow:step', (data) => broadcast('workflow-step', data));
        this._on('workflow:interaction-needed', (data) => broadcast('workflow-interaction-needed', data));
        this._on('workflow:completed', (data) => broadcast('workflow-completed', data));
        this._on('workflow:error', (data) => broadcast('workflow-error', data));
        
        // Tool Confirmation Events
        this._on('tool:confirmation-request', (data) => broadcast('tool-confirmation-request', data));

        // Agent Loop Events
        this._on('agent-loop:state-changed', (data) => broadcast('agent-loop-state', data));
        this._on('agent-loop:invocation', (data) => broadcast('agent-loop-invocation', data));

        // Conversation Management Events
        this._on('server:conversation-switched', (data) => broadcast('conversation-switched', data));
        this._on('server:conversation-list', (data) => broadcast('conversation-list', data));

        // Embed Events — inline embedded objects (YouTube, Spotify, etc.)
        this._on('embed:created', (data) => {
            broadcast('message', data);
        });

        // Agent Loop Chat Integration — inject agent loop results into main chat
        this._on('agent-loop:chat-message', (data) => {
            broadcast('message', data);
        });

        // Cloud Realtime Events
        this._on('cloud:auth:logged-in', (data) => broadcast('cloud:status', data));
        this._on('cloud:auth:logged-out', () => broadcast('cloud:status', { loggedIn: false }));
        this._on('cloud:sync-status', (data) => broadcast('cloud:sync-status', data));
        this._on('cloud:presence:updated', (data) => broadcast('cloud:presence', data));
        this._on('cloud:message:received', (data) => {
            broadcast('message', {
                id: data.id || `cloud-msg-${Date.now()}`,
                role: data.role === 'assistant' ? 'ai' : 'user',
                type: 'text',
                content: data.content,
                timestamp: new Date().toLocaleString(),
                isCloud: true,
            });
        });

        // Cloud AI Usage Updates — push real-time usage data to UI after each cloud AI call
        this._on('cloud:usage-update', (data) => broadcast('cloud:usage', data));

        // WebLLM Bridge — forward generate requests to browser, collect responses
        this._on('webllm:generate', (data) => {
            broadcast('webllm:generate', data);
        });

        // Agent Loop Blocking Questions
        this._on('agent-loop:question', (data) => {
            broadcast('agent-loop-question', data);
            // Also broadcast as a regular chat message so it appears in the conversation
            broadcast('message', {
                id: `agent-loop-q-${Date.now()}`,
                role: 'ai',
                type: 'agent-loop-question',
                content: `🤖❓ **Question from Background Agent:**\n\n${data.question}\n\n*Please respond to continue the background agent's work.*`,
                timestamp: data.timestamp || new Date().toLocaleString(),
                questionId: data.questionId,
                isAgentLoop: true
            });
        });

        // Checkpoint/Recovery Events
        this._on('checkpoint:recovery-pending', (data) => {
            broadcast('checkpoint-recovery-pending', data);
            // Also broadcast a system message to notify the user
            if (data.tasks && data.tasks.length > 0) {
                const taskList = data.tasks.map(t => `• ${t.description || t.taskId} (turn ${t.turnNumber || 0})`).join('\n');
                broadcast('message', {
                    id: `recovery-${Date.now()}`,
                    role: 'ai',
                    type: 'system',
                    content: `🔄 **Recovered Tasks Available**\n\nThe server was restarted and found ${data.tasks.length} task(s) that were interrupted:\n\n${taskList}\n\n_These tasks have been queued for recovery. Background tasks will resume automatically. For foreground requests, you may need to re-submit._`,
                    timestamp: new Date().toLocaleString(),
                    isRecovery: true
                });
            }
        });

        this._on('checkpoint:resumed', (data) => {
            broadcast('checkpoint-resumed', data);
        });
    }
}
