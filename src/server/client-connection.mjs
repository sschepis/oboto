import { consoleStyler } from '../ui/console-styler.mjs';
import { convertHistoryToUIMessages } from './ws-helpers.mjs';
import { isLLMAuthError, buildLLMAuthErrorPayload } from './llm-error-detector.mjs';

/**
 * Send a JSON payload to a WebSocket only if it is still open.
 * Prevents uncaught errors when the client disconnects mid-flight.
 * @param {import('ws').WebSocket} ws
 * @param {object} data
 */
function safeSend(ws, data) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

export class ClientConnectionHandler {
    constructor(dependencies) {
        this.wss = dependencies.wss;
        this.assistant = dependencies.assistant;
        this.dispatcher = dependencies.dispatcher;
        this.broadcast = dependencies.broadcast;
        this.broadcastFileTree = dependencies.broadcastFileTree;
        this.eventBus = dependencies.eventBus;
        this.agentLoopController = dependencies.agentLoopController;
        this.schedulerService = dependencies.schedulerService;
        this.secretsManager = dependencies.secretsManager;
        this.workspaceContentServer = dependencies.workspaceContentServer;
        this.cloudLoader = dependencies.cloudLoader;
        this.activeController = dependencies.activeController;
    }

    initialize() {
        this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    }

    handleConnection(ws, req) {
        // Store the HTTP upgrade request on the WebSocket for downstream handlers
        ws._req = req;
        consoleStyler.log('system', 'Client connected');

        // Send connection status
        safeSend(ws, { type: 'status', payload: 'connected' });

        this.sendInitialState(ws);

        ws.on('message', async (message) => this.handleMessage(ws, message));

        ws.on('close', () => {
            consoleStyler.log('system', 'Client disconnected');
        });
    }

    sendInitialState(ws) {
        const { assistant, agentLoopController, schedulerService, workspaceContentServer, cloudLoader } = this;

        // Send current conversation history
        try {
            const history = assistant.historyManager.getHistory();
            const uiMessages = convertHistoryToUIMessages(history);
            if (uiMessages.length > 0) {
                safeSend(ws, { type: 'history-loaded', payload: uiMessages });
            }
        } catch (e) {
            consoleStyler.log('warning', `Failed to send history to new client: ${e.message}`);
        }

        // Send conversation list
        if (assistant.conversationManager) {
            assistant.listConversations().then(conversations => {
                try {
                    safeSend(ws, { type: 'conversation-list', payload: conversations });
                    safeSend(ws, {
                        type: 'conversation-switched',
                        payload: {
                            name: assistant.getActiveConversationName(),
                            isDefault: assistant.conversationManager.isDefaultConversation()
                        }
                    });
                } catch (e) {
                    consoleStyler.log('warning', `Failed to send conversation info to new client: ${e.message}`);
                }
            }).catch(e => {
                consoleStyler.log('warning', `Failed to list conversations for new client: ${e.message}`);
            });
        }

        // Send workspace status
        try {
            safeSend(ws, {
                type: 'workspace:status',
                payload: {
                    path: assistant.workingDir,
                    active: true,
                    agentLoopState: agentLoopController ? agentLoopController.getState().state : 'unknown',
                    schedules: schedulerService ? schedulerService.listSchedules('all').length : 0,
                    schedulesActive: schedulerService ? schedulerService.listSchedules('active').length : 0,
                }
            });
        } catch (e) {
            // Ignore
        }

        // Send agent loop state
        if (agentLoopController) {
            try {
                safeSend(ws, { type: 'agent-loop-state', payload: agentLoopController.getState() });
            } catch (e) {
                // Ignore
            }
        }

        // Send task list
        if (assistant.taskManager) {
            try {
                const tasks = assistant.taskManager.listTasks('all');
                safeSend(ws, { type: 'task-list', payload: tasks });
            } catch (e) {
                // Ignore
            }
        }

        // Send workspace content server info
        if (workspaceContentServer) {
            try {
                safeSend(ws, {
                    type: 'workspace:server-info',
                    payload: { port: workspaceContentServer.getPort() }
                });
            } catch (e) {
                // Ignore
            }
        }

        // Send plugin UI manifest
        if (assistant.pluginManager) {
            try {
                const uiManifest = assistant.pluginManager.getAllUIComponents();
                const pluginList = assistant.pluginManager.listPlugins();
                safeSend(ws, { type: 'plugin:ui-manifest', payload: uiManifest });
                safeSend(ws, { type: 'plugin:list', payload: { plugins: pluginList } });
            } catch (e) {
                // Ignore
            }
        }

        // Send cloud status
        if (cloudLoader && cloudLoader.instance) {
            try {
                safeSend(ws, {
                    type: 'cloud:status',
                    payload: cloudLoader.instance.getStatus()
                });
            } catch (e) {
                // Ignore
            }
        }
    }

    async handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);
            const ctx = {
                ws,
                assistant: this.assistant,
                broadcast: this.broadcast,
                eventBus: this.eventBus,
                agentLoopController: this.agentLoopController,
                schedulerService: this.schedulerService,
                secretsManager: this.secretsManager,
                activeController: this.activeController,
                broadcastFileTree: this.broadcastFileTree,
                workspaceContentServer: this.workspaceContentServer,
                cloudSync: this.cloudLoader ? this.cloudLoader.instance : null,
                initCloudSync: this.cloudLoader ? this.cloudLoader.initCloudSync : null,
                pluginManager: this.assistant.pluginManager || null,
                dispatcher: this.dispatcher,
            };
            
            const handled = await this.dispatcher.dispatch(data, ctx);
            if (!handled) {
                consoleStyler.log('warning', `Unknown WebSocket message type: ${data.type}`);
            }
        } catch (error) {
            consoleStyler.log('error', `WebSocket error: ${error.message}`);
            
            if (isLLMAuthError(error)) {
                const payload = buildLLMAuthErrorPayload(error, 'chat');
                this.broadcast('llm-auth-error', payload);
                safeSend(ws, {
                    type: 'message',
                    payload: {
                        id: Date.now().toString(),
                        role: 'ai',
                        type: 'text',
                        content: `🔑 **LLM API Key Error**\n\n${payload.suggestion}\n\n_Original error: ${payload.errorMessage}_`,
                        timestamp: new Date().toLocaleString()
                    }
                });
            } else {
                safeSend(ws, {
                    type: 'error',
                    payload: error.message
                });
            }
        }
    }
}
