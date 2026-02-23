import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { consoleStyler } from '../ui/console-styler.mjs';
import { fetchRemoteModels } from '../core/model-registry.mjs';
import { ChromeWsBridge } from './chrome-ws-bridge.mjs';
import { UIStyleHandlers } from '../execution/handlers/ui-style-handlers.mjs';
import { WsDispatcher } from './ws-dispatcher.mjs';
import { convertHistoryToUIMessages, getDirectoryTree } from './ws-helpers.mjs';
import { isLLMAuthError, buildLLMAuthErrorPayload } from './llm-error-detector.mjs';

// Handler modules
import { handlers as chatHandlers } from './ws-handlers/chat-handler.mjs';
import { handlers as fileHandlers } from './ws-handlers/file-handler.mjs';
import { handlers as surfaceHandlers } from './ws-handlers/surface-handler.mjs';
import { handlers as conversationHandlers } from './ws-handlers/conversation-handler.mjs';
import { handlers as agentLoopHandlers } from './ws-handlers/agent-loop-handler.mjs';
import { handlers as taskHandlers } from './ws-handlers/task-handler.mjs';
import { handlers as settingsHandlers } from './ws-handlers/settings-handler.mjs';
import { handlers as secretsHandlers } from './ws-handlers/secrets-handler.mjs';
import { handlers as styleHandlers } from './ws-handlers/style-handler.mjs';
import { handlers as workflowHandlers } from './ws-handlers/workflow-handler.mjs';
import { handlers as openclawHandlers } from './ws-handlers/openclaw-handler.mjs';
import { handlers as setupHandlers } from './ws-handlers/setup-handler.mjs';
import { handlers as miscHandlers } from './ws-handlers/misc-handler.mjs';
import { handlers as workspaceHandlers } from './ws-handlers/workspace-handler.mjs';
import { handlers as skillsHandlers } from './ws-handlers/skills-handler.mjs';
import { handlers as cloudHandlers } from './ws-handlers/cloud-handler.mjs';
import { mountDynamicRoutes } from './dynamic-router.mjs';

// Dynamic import for node-pty (native addon)
let pty = null;
/*
try {
    pty = await import('node-pty');
    if (pty.default) pty = pty.default;
} catch (e) {
    // node-pty not available — terminal feature disabled
}
*/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Build and configure the message dispatcher ──────────────────────────
function buildDispatcher() {
    const dispatcher = new WsDispatcher();
    dispatcher.registerAll(chatHandlers);
    dispatcher.registerAll(fileHandlers);
    dispatcher.registerAll(surfaceHandlers);
    dispatcher.registerAll(conversationHandlers);
    dispatcher.registerAll(agentLoopHandlers);
    dispatcher.registerAll(taskHandlers);
    dispatcher.registerAll(settingsHandlers);
    dispatcher.registerAll(secretsHandlers);
    dispatcher.registerAll(styleHandlers);
    dispatcher.registerAll(workflowHandlers);
    dispatcher.registerAll(openclawHandlers);
    dispatcher.registerAll(setupHandlers);
    dispatcher.registerAll(miscHandlers);
    dispatcher.registerAll(workspaceHandlers);
    dispatcher.registerAll(skillsHandlers);
    dispatcher.registerAll(cloudHandlers);
    return dispatcher;
}

export async function startServer(assistant, workingDir, eventBus, port = 3000, schedulerService = null, secretsManager = null, agentLoopController = null, workspaceContentServer = null, cloudSync = null) {
    const app = express();
    // Mutable reference holder so handlers can read/write the active AbortController
    const activeController = { controller: null };

    // Mutable cloudSync reference — allows lazy initialization when secrets are set after startup
    const cloudSyncHolder = { instance: cloudSync };

    /**
     * Lazy-initialize CloudSync when cloud secrets become available after startup.
     * Called by the secrets handler when OBOTO_CLOUD_URL or OBOTO_CLOUD_KEY are set.
     * @returns {Promise<object|null>} The CloudSync instance, or null if secrets aren't complete
     */
    const initCloudSync = async () => {
        // Already initialized
        if (cloudSyncHolder.instance) return cloudSyncHolder.instance;

        const url = process.env.OBOTO_CLOUD_URL;
        const key = process.env.OBOTO_CLOUD_KEY;
        if (!url || !key) return null;

        try {
            const { CloudSync } = await import('../cloud/cloud-sync.mjs');
            const { loadCloudConfig } = await import('../cloud/cloud-config.mjs');
            const cloudConfig = loadCloudConfig();
            if (!cloudConfig) return null;

            const newCloudSync = new CloudSync(eventBus, secretsManager);
            await newCloudSync.initialize(cloudConfig);
            newCloudSync.setWorkingDir(workingDir);

            // Register in assistant's service registry
            if (assistant._services) {
                assistant._services.register('cloudSync', newCloudSync);
            }

            // Set up AI provider cloud reference
            try {
                const { setCloudSyncRef, setEventBusRef } = await import('../core/ai-provider.mjs');
                setCloudSyncRef(newCloudSync);
                setEventBusRef(eventBus);
            } catch (e) {
                // ai-provider refs are optional
            }

            // Auto-login from cached refresh token (silent, non-blocking)
            newCloudSync.tryAutoLogin().catch(err => {
                consoleStyler.log('warning', `Cloud auto-login failed: ${err.message}`);
            });

            cloudSyncHolder.instance = newCloudSync;
            consoleStyler.log('system', '☁️  Cloud initialized from secrets vault');

            return newCloudSync;
        } catch (err) {
            consoleStyler.log('warning', `Failed to initialize cloud from secrets: ${err.message}`);
            return null;
        }
    };
    
    // Serve static files from ui/dist
    // The UI build lives in the project root, NOT the user's workspace directory.
    // __dirname points to src/server/, so project root is two levels up.
    const projectRoot = path.resolve(__dirname, '..', '..');
    const uiDistPath = path.join(projectRoot, 'ui', 'dist');

    // Mount dynamic routes from workspace
    try {
        await mountDynamicRoutes(app, workingDir);
    } catch (e) {
        consoleStyler.log('warning', `Failed to mount dynamic routes: ${e.message}`);
    }

    // Serve generated images
    const generatedImagesPath = path.join(workingDir, 'public', 'generated-images');
    if (!fs.existsSync(generatedImagesPath)) {
        try {
            fs.mkdirSync(generatedImagesPath, { recursive: true });
        } catch (e) {
            consoleStyler.log('warning', `Failed to create generated images directory: ${e.message}`);
        }
    }
    app.use('/generated-images', express.static(generatedImagesPath));
    
    if (fs.existsSync(uiDistPath)) {
        app.use(express.static(uiDistPath));
    } else {
        consoleStyler.log('warning', `UI build not found at ${uiDistPath}`);
        consoleStyler.log('warning', 'Please run "npm run build:ui" to build the web interface.');
        
        app.get('/', (req, res) => {
            res.send(`
                <html>
                    <body style="font-family: sans-serif; background: #111; color: #fff; padding: 2rem; text-align: center;">
                        <h1>Oboto AI Server</h1>
                        <p>Server is running, but the UI has not been built.</p>
                        <p>Please run <code>npm run build:ui</code> in the project root.</p>
                    </body>
                </html>
            `);
        });
    }

    const server = app.listen(port, () => {
        consoleStyler.log('system', `Server running at http://localhost:${port}`);
        if (fs.existsSync(uiDistPath)) {
            consoleStyler.log('system', `Serving UI from: ${uiDistPath}`);
        }
    });

    // WebSocket servers — chat (default) and terminal (PTY)
    const wss = new WebSocketServer({ noServer: true });
    const terminalWss = new WebSocketServer({ noServer: true });
    const chromeWss = new WebSocketServer({ noServer: true });

    // Route upgrade requests based on URL path
    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === '/ws/terminal') {
            terminalWss.handleUpgrade(request, socket, head, (ws) => {
                terminalWss.emit('connection', ws, request);
            });
        } else if (url.pathname === '/ws/chrome') {
            chromeWss.handleUpgrade(request, socket, head, (ws) => {
                chromeWss.emit('connection', ws, request);
            });
        } else {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });

    // ── Chrome Extension WebSocket handler ──────────────────────────────
    const chromeWsBridge = new ChromeWsBridge(eventBus);
    chromeWss.on('connection', (ws) => {
        consoleStyler.log('system', 'Chrome extension connected');
        chromeWsBridge.attach(ws);
        if (eventBus) eventBus.emit('chrome:connected');
    });

    // Attach to assistant
    if (assistant) {
        assistant.chromeWsBridge = chromeWsBridge;
        if (assistant.toolExecutor && assistant.toolExecutor.attachChromeBridge) {
            assistant.toolExecutor.attachChromeBridge(chromeWsBridge);
        }
    }

    // ── Terminal PTY WebSocket handler ──────────────────────────────────
    setupTerminalWebSocket(terminalWss, assistant);

    // Broadcast helper
    const broadcast = (type, payload) => {
        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(JSON.stringify({ type, payload }));
            }
        });
    };

    // Helper to broadcast file tree updates to all clients
    const broadcastFileTree = async () => {
        try {
            const tree = await getDirectoryTree(assistant.workingDir, 2);
            broadcast('file-tree', tree);
        } catch (e) {
            consoleStyler.log('error', `Failed to broadcast file tree: ${e.message}`);
        }
    };

    // Hook up event bus BEFORE loading conversation so events are captured
    if (eventBus) {
        eventBus.on('server:log', (data) => broadcast('log', data));
        eventBus.on('server:progress', (data) => broadcast('progress', data));
        eventBus.on('server:tool-start', (data) => broadcast('tool-start', data));
        eventBus.on('server:tool-end', (data) => {
            broadcast('tool-end', data);
            
            // Auto-refresh file tree if tool was a file system mutation
            if (data.toolName && (
                data.toolName === 'write_to_file' || 
                data.toolName === 'delete_file' || 
                data.toolName === 'apply_diff' || 
                data.toolName === 'edit_file' || 
                data.toolName === 'create_directory' || 
                data.toolName === 'move_file' ||
                data.toolName === 'bootstrap_project' || 
                data.toolName.startsWith('mcp_filesystem_')
            )) {
                broadcastFileTree();
            }
        });
        eventBus.on('server:next-steps', (data) => broadcast('next-steps', data));
        eventBus.on('server:history-loaded', (data) => {
            const uiMessages = convertHistoryToUIMessages(data);
            broadcast('history-loaded', uiMessages);
        });

        // Task Lifecycle Events
        eventBus.on('task:spawned', (data) => broadcast('task-spawned', data));
        eventBus.on('task:started', (data) => broadcast('task-started', data));
        eventBus.on('task:progress', (data) => broadcast('task-progress', data));
        eventBus.on('task:output', (data) => broadcast('task-output', data));
        eventBus.on('task:completed', (data) => broadcast('task-completed', data));
        eventBus.on('task:failed', (data) => {
            broadcast('task-failed', data);
            // Detect LLM auth errors from background tasks (agent loop, scheduled tasks)
            // and broadcast the llm-auth-error event to redirect users to secrets config
            const errorMsg = data.error || data.message || '';
            if (isLLMAuthError(errorMsg)) {
                const payload = buildLLMAuthErrorPayload(errorMsg, data.taskId ? 'agent-loop' : 'task');
                broadcast('llm-auth-error', payload);
                consoleStyler.log('error', `LLM auth error detected in background task — broadcasting secrets redirect`);
                // Stop the agent loop to prevent repeated failures
                if (agentLoopController && agentLoopController.state === 'playing') {
                    agentLoopController.stop();
                    consoleStyler.log('system', '⏹ Agent loop stopped due to LLM auth error');
                }
            }
        });
        eventBus.on('task:cancelled', (data) => broadcast('task-cancelled', data));

        // Schedule Events
        eventBus.on('schedule:created', (data) => broadcast('schedule-created', data));
        eventBus.on('schedule:paused', (data) => broadcast('schedule-paused', data));
        eventBus.on('schedule:resumed', (data) => broadcast('schedule-resumed', data));
        eventBus.on('schedule:deleted', (data) => broadcast('schedule-deleted', data));
        eventBus.on('schedule:fired', (data) => broadcast('schedule-fired', data));

        // Surface Events
        eventBus.on('surface:created', (data) => broadcast('surface-created', data));
        eventBus.on('surface:updated', (data) => broadcast('surface-updated', data));
        eventBus.on('surface:deleted', (data) => broadcast('surface-deleted', data));
        eventBus.on('surface:opened', (data) => broadcast('surface-opened', data));
        eventBus.on('surface:layout-updated', (data) => broadcast('surface-layout-updated', data));
        eventBus.on('surface:request-screenshot', (data) => broadcast('request-screenshot', data));

        // UI Style Events
        eventBus.on('ui-style:theme', (data) => broadcast('ui-style-theme', data));
        eventBus.on('ui-style:tokens', (data) => broadcast('ui-style-tokens', data));
        eventBus.on('ui-style:css', (data) => broadcast('ui-style-css', data));
        eventBus.on('ui-style:reset', (data) => broadcast('ui-style-reset', data));
        eventBus.on('ui-display-names', (data) => broadcast('ui-display-names', data));

        // Workflow Events (BubbleLab integration)
        eventBus.on('workflow:started', (data) => broadcast('workflow-started', data));
        eventBus.on('workflow:step', (data) => broadcast('workflow-step', data));
        eventBus.on('workflow:interaction-needed', (data) => broadcast('workflow-interaction-needed', data));
        eventBus.on('workflow:completed', (data) => broadcast('workflow-completed', data));
        eventBus.on('workflow:error', (data) => broadcast('workflow-error', data));
        
        // Tool Confirmation Events
        eventBus.on('tool:confirmation-request', (data) => broadcast('tool-confirmation-request', data));

        // Agent Loop Events
        eventBus.on('agent-loop:state-changed', (data) => broadcast('agent-loop-state', data));
        eventBus.on('agent-loop:invocation', (data) => broadcast('agent-loop-invocation', data));

        // Conversation Management Events
        eventBus.on('server:conversation-switched', (data) => broadcast('conversation-switched', data));
        eventBus.on('server:conversation-list', (data) => broadcast('conversation-list', data));

        // Embed Events — inline embedded objects (YouTube, Spotify, etc.)
        eventBus.on('embed:created', (data) => {
            broadcast('message', data);
        });

        // Agent Loop Chat Integration — inject agent loop results into main chat
        eventBus.on('agent-loop:chat-message', (data) => {
            broadcast('message', data);
        });

        // Cloud Realtime Events
        eventBus.on('cloud:auth:logged-in', (data) => broadcast('cloud:status', data));
        eventBus.on('cloud:auth:logged-out', () => broadcast('cloud:status', { loggedIn: false }));
        eventBus.on('cloud:sync-status', (data) => broadcast('cloud:sync-status', data));
        eventBus.on('cloud:presence:updated', (data) => broadcast('cloud:presence', data));
        eventBus.on('cloud:message:received', (data) => {
            broadcast('message', {
                id: data.id || `cloud-msg-${Date.now()}`,
                role: data.role === 'assistant' ? 'ai' : 'user',
                type: 'text',
                content: data.content,
                timestamp: new Date().toLocaleString(),
                isCloud: true,
            });
        });

        // WebLLM Bridge — forward generate requests to browser, collect responses
        eventBus.on('webllm:generate', (data) => {
            broadcast('webllm:generate', data);
        });

        // Agent Loop Blocking Questions
        eventBus.on('agent-loop:question', (data) => {
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
        eventBus.on('checkpoint:recovery-pending', (data) => {
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

        eventBus.on('checkpoint:resumed', (data) => {
            broadcast('checkpoint-resumed', data);
        });
    }

    // Load initial conversation if exists (after event bus is wired up)
    await assistant.loadConversation();

    // Fetch real model lists from provider APIs (non-blocking)
    fetchRemoteModels().catch(err => {
        consoleStyler.log('warning', `Initial model fetch failed: ${err.message}`);
    });

    // Build the message dispatcher
    const dispatcher = buildDispatcher();

    // ── Auto-activate agent loop for headless / service mode ────────────
    if (process.env.OBOTO_AUTO_ACTIVATE === 'true' && agentLoopController) {
        const autoActivateDelay = parseInt(process.env.OBOTO_AUTO_ACTIVATE_DELAY || '3000', 10);
        setTimeout(() => {
            consoleStyler.log('system', '🤖 Auto-activating agent loop (OBOTO_AUTO_ACTIVATE=true)');
            agentLoopController.play().catch(err => {
                consoleStyler.log('error', `Auto-activate agent loop failed: ${err.message}`);
            });
        }, autoActivateDelay);
    }

    wss.on('connection', (ws) => {
        consoleStyler.log('system', 'Client connected');

        // Send connection status (not a chat message)
        ws.send(JSON.stringify({
            type: 'status',
            payload: 'connected'
        }));

        // Send current conversation history to newly connected client
        try {
            const history = assistant.historyManager.getHistory();
            const uiMessages = convertHistoryToUIMessages(history);
            if (uiMessages.length > 0) {
                ws.send(JSON.stringify({ type: 'history-loaded', payload: uiMessages }));
            }
        } catch (e) {
            consoleStyler.log('warning', `Failed to send history to new client: ${e.message}`);
        }

        // Send current conversation info to newly connected client
        if (assistant.conversationManager) {
            assistant.listConversations().then(conversations => {
                try {
                    ws.send(JSON.stringify({ type: 'conversation-list', payload: conversations }));
                    ws.send(JSON.stringify({
                        type: 'conversation-switched',
                        payload: {
                            name: assistant.getActiveConversationName(),
                            isDefault: assistant.conversationManager.isDefaultConversation()
                        }
                    }));
                } catch (e) {
                    consoleStyler.log('warning', `Failed to send conversation info to new client: ${e.message}`);
                }
            }).catch(e => {
                consoleStyler.log('warning', `Failed to list conversations for new client: ${e.message}`);
            });
        }

        // Send current workspace status to newly connected client
        try {
            ws.send(JSON.stringify({
                type: 'workspace:status',
                payload: {
                    path: assistant.workingDir,
                    active: true,
                    agentLoopState: agentLoopController ? agentLoopController.getState().state : 'unknown',
                    schedules: schedulerService ? schedulerService.listSchedules('all').length : 0,
                    schedulesActive: schedulerService ? schedulerService.listSchedules('active').length : 0,
                }
            }));
        } catch (e) {
            // Ignore
        }

        // Send current agent loop state to newly connected client
        if (agentLoopController) {
            try {
                ws.send(JSON.stringify({ type: 'agent-loop-state', payload: agentLoopController.getState() }));
            } catch (e) {
                // Ignore
            }
        }

        // Send current task list to newly connected client (for restoration visibility)
        if (assistant.taskManager) {
            try {
                const tasks = assistant.taskManager.listTasks('all');
                ws.send(JSON.stringify({ type: 'task-list', payload: tasks }));
            } catch (e) {
                // Ignore
            }
        }

        // Send current display names and theme to newly connected client
        if (assistant.toolExecutor?.uiStyleHandlers) {
            try {
                const handler = assistant.toolExecutor.uiStyleHandlers;
                const names = handler.displayNames;
                if (names.userName || names.agentName) {
                    ws.send(JSON.stringify({ type: 'ui-display-names', payload: names }));
                }
                // Resend current theme if it's been changed from the default
                if (handler.currentTheme !== 'midnight') {
                    const preset = UIStyleHandlers.getPreset(handler.currentTheme);
                    const tokens = preset || handler.activeTokenOverrides;
                    if (tokens && Object.keys(tokens).length > 0) {
                        ws.send(JSON.stringify({ type: 'ui-style-theme', payload: { theme: handler.currentTheme, tokens } }));
                    }
                }
            } catch (e) {
                // Ignore
            }
        }

        // Send workspace content server info to newly connected client
        if (workspaceContentServer) {
            try {
                ws.send(JSON.stringify({ 
                    type: 'workspace:server-info', 
                    payload: { port: workspaceContentServer.getPort() } 
                }));
            } catch (e) {
                // Ignore
            }
        }

        // Send cloud status to newly connected client
        if (cloudSyncHolder.instance) {
            try {
                ws.send(JSON.stringify({
                    type: 'cloud:status',
                    payload: cloudSyncHolder.instance.getStatus()
                }));
            } catch (e) {
                // Ignore
            }
        }

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                const ctx = {
                    ws,
                    assistant,
                    broadcast,
                    eventBus,
                    agentLoopController,
                    schedulerService,
                    secretsManager,
                    activeController,
                    broadcastFileTree,
                    workspaceContentServer,
                    cloudSync: cloudSyncHolder.instance,
                    initCloudSync,
                };
                const handled = await dispatcher.dispatch(data, ctx);
                if (!handled) {
                    consoleStyler.log('warning', `Unknown WebSocket message type: ${data.type}`);
                }
            } catch (error) {
                consoleStyler.log('error', `WebSocket error: ${error.message}`);
                // Check if this is an LLM auth/key error — redirect to secrets view
                if (isLLMAuthError(error)) {
                    const payload = buildLLMAuthErrorPayload(error, 'chat');
                    broadcast('llm-auth-error', payload);
                    ws.send(JSON.stringify({
                        type: 'message',
                        payload: {
                            id: Date.now().toString(),
                            role: 'ai',
                            type: 'text',
                            content: `🔑 **LLM API Key Error**\n\n${payload.suggestion}\n\n_Original error: ${payload.errorMessage}_`,
                            timestamp: new Date().toLocaleString()
                        }
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: error.message
                    }));
                }
            }
        });

        ws.on('close', () => {
            consoleStyler.log('system', 'Client disconnected');
        });
    });

    // Keep process alive
    return new Promise(() => {}); 
}

/**
 * Set up the terminal PTY WebSocket server.
 * Each connected client gets its own pseudo-terminal via node-pty.
 * Protocol:
 *   - Binary/text frames from client → PTY stdin
 *   - PTY stdout → binary/text frames to client
 *   - JSON frames with { type: 'resize', cols, rows } → PTY resize
 *   - JSON frames with { type: 'cwd', path } → change working directory (spawns new PTY)
 */
function setupTerminalWebSocket(terminalWss, assistant) {
    const defaultShell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');

    terminalWss.on('connection', (ws) => {
        const cwd = assistant?.workingDir || process.cwd();
        
        // Try node-pty first
        if (pty) {
            consoleStyler.log('system', `Terminal PTY session started (shell: ${defaultShell}, cwd: ${cwd})`);
            
            let ptyProcess;
            try {
                ptyProcess = pty.spawn(defaultShell, [], {
                    name: 'xterm-256color',
                    cols: 120,
                    rows: 30,
                    cwd,
                    env: {
                        ...process.env,
                        TERM: 'xterm-256color',
                        COLORTERM: 'truecolor',
                    },
                });
            } catch (err) {
                consoleStyler.log('error', `Failed to spawn PTY: ${err.message}. Falling back to basic shell.`);
                // Fallback if pty.spawn fails
                setupFallbackShell(ws, defaultShell, cwd);
                return;
            }

            // PTY → Client
            ptyProcess.onData((data) => {
                if (ws.readyState === 1) {
                    ws.send(data);
                }
            });

            ptyProcess.onExit(({ exitCode, signal }) => {
                consoleStyler.log('system', `Terminal PTY exited (code: ${exitCode}, signal: ${signal})`);
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
                    ws.close();
                }
            });

            // Client → PTY
            ws.on('message', (message) => {
                try {
                    // Try parsing as JSON for control messages
                    if (typeof message === 'string' || (message instanceof Buffer && message[0] === 0x7b)) {
                        const str = message.toString();
                        if (str.startsWith('{')) {
                            const parsed = JSON.parse(str);
                            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
                                try {
                                    ptyProcess.resize(parseInt(parsed.cols, 10), parseInt(parsed.rows, 10));
                                } catch (e) {
                                    // ignore resize errors
                                }
                                return;
                            }
                        }
                    }
                } catch {
                    // Not JSON — treat as terminal input
                }
                // Forward raw input to PTY
                try {
                    ptyProcess.write(message.toString());
                } catch (e) {
                    // ignore write errors
                }
            });

            ws.on('close', () => {
                consoleStyler.log('system', 'Terminal PTY session closed');
                try {
                    ptyProcess.kill();
                } catch {
                    // Already dead
                }
            });

            ws.on('error', (err) => {
                consoleStyler.log('error', `Terminal WS error: ${err.message}`);
                try {
                    ptyProcess.kill();
                } catch {
                    // Already dead
                }
            });

            // Send initial ready signal
            ws.send(JSON.stringify({ type: 'ready', shell: defaultShell, cwd }));

        } else {
            consoleStyler.log('warning', 'node-pty not available — using Python PTY bridge');
            setupPythonPty(ws, defaultShell, cwd);
        }
    });
}

/**
 * Uses Python's pty module to create a real pseudo-terminal when node-pty is unavailable.
 * This supports colors, job control, and proper interactive behavior.
 */
function setupPythonPty(ws, shellCommand, cwd) {
    const pythonScript = `
import pty, sys, os, select, subprocess, time

try:
    master, slave = pty.openpty()
    
    # Spawn shell in slave PTY
    # Force interactive mode (-i)
    cmd = sys.argv[1:]
    if 'bash' in cmd[0] or 'zsh' in cmd[0]:
        if '-i' not in cmd: cmd.append('-i')

    p = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, close_fds=True, preexec_fn=os.setsid)
    os.close(slave)
    
    # Proxy loop
    while p.poll() is None:
        r, w, e = select.select([sys.stdin, master], [], [], 0.1)
        
        # Stdin (from JS) -> PTY Master
        if sys.stdin in r:
            try:
                d = os.read(sys.stdin.fileno(), 4096)
                if not d: break
                os.write(master, d)
            except OSError: break
            
        # PTY Master -> Stdout (to JS)
        if master in r:
            try:
                d = os.read(master, 4096)
                if not d: break
                os.write(sys.stdout.fileno(), d)
                sys.stdout.flush()
            except OSError: break
            
except Exception:
    pass
finally:
    try:
        p.terminate()
        p.wait()
    except:
        pass
`;

    try {
        consoleStyler.log('system', `Spawning Python PTY bridge for: ${shellCommand}`);
        
        const shellProcess = spawn('python3', ['-c', pythonScript, shellCommand], {
            cwd,
            // We have a real PTY, so we can claim xterm-256color support
            env: { ...process.env, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        shellProcess.stdout.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.on('exit', (code) => {
            consoleStyler.log('system', `Python PTY exited (code: ${code})`);
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'exit', exitCode: code }));
                ws.close();
            }
        });
        
        shellProcess.on('error', (err) => {
             // Fallback to dumb shell if python3 is missing
             consoleStyler.log('error', `Python PTY failed: ${err.message}. Falling back to dumb shell.`);
             setupDumbShell(ws, shellCommand, cwd);
        });

        ws.on('message', (message) => {
            try {
                // Ignore JSON control messages
                if (typeof message === 'string' && message.startsWith('{')) return;
                
                if (shellProcess.stdin && !shellProcess.stdin.destroyed) {
                    shellProcess.stdin.write(message.toString());
                }
            } catch (e) {}
        });

        ws.on('close', () => {
            try { shellProcess.kill(); } catch {}
        });

        // Send ready signal - indicate fallback mode but it's a good fallback
        ws.send(JSON.stringify({ type: 'ready', shell: shellCommand, cwd, mode: 'fallback-pty' }));

    } catch (e) {
        setupDumbShell(ws, shellCommand, cwd);
    }
}

/**
 * Last resort fallback: pipe-based shell (non-interactive, no PTY).
 * Used if both node-pty and python3 are unavailable.
 */
function setupDumbShell(ws, shellCommand, cwd) {
    try {
        consoleStyler.log('system', `Dumb shell spawned: ${shellCommand}`);
        
        const args = [];
        if (shellCommand.endsWith('bash') || shellCommand.endsWith('zsh')) {
            args.push('-i');
        }

        const shellProcess = spawn(shellCommand, args, {
            cwd,
            env: { ...process.env, TERM: 'dumb', PS1: '$ ', PROMPT: '$ ' },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        shellProcess.stdout.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.on('exit', (code) => {
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'exit', exitCode: code }));
                ws.close();
            }
        });
        
        ws.on('message', (message) => {
            try {
                if (typeof message === 'string' && message.startsWith('{')) return;
                if (shellProcess.stdin) shellProcess.stdin.write(message.toString());
            } catch (e) {}
        });

        ws.on('close', () => {
            try { shellProcess.kill(); } catch {}
        });

        ws.send(JSON.stringify({ type: 'ready', shell: shellCommand, cwd, mode: 'fallback-dumb' }));

    } catch (e) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message: `All shell spawn attempts failed: ${e.message}` }));
            ws.close();
        }
    }
}
