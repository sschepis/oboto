import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { consoleStyler } from '../ui/console-styler.mjs';
import { fetchRemoteModels } from '../core/model-registry.mjs';
import { ChromeWsBridge } from './chrome-ws-bridge.mjs';
import { WsDispatcher } from './ws-dispatcher.mjs';
import { TerminalService } from './terminal-service.mjs';
import { EventBroadcaster } from './event-broadcaster.mjs';
import { ClientConnectionHandler } from './client-connection.mjs';
import { CloudLoader } from './cloud-loader.mjs';

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
import { handlers as pluginHandlers } from './ws-handlers/plugin-handler.mjs';
import { mountDynamicRoutes } from './dynamic-router.mjs';

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
    dispatcher.registerAll(pluginHandlers);
    return dispatcher;
}

export async function startServer(assistant, workingDir, eventBus, port = 3000, schedulerService = null, secretsManager = null, agentLoopController = null, workspaceContentServer = null, cloudSync = null) {
    const app = express();
    // Mutable reference holder so handlers can read/write the active AbortController
    const activeController = { controller: null };

    // ── Cloud Loader ───────────────────────────────────────────────────
    const cloudLoader = new CloudLoader(eventBus, secretsManager, workingDir, assistant, cloudSync);
    
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

    // Attach to assistant (used by chrome-ext plugin if loaded)
    if (assistant) {
        assistant.chromeWsBridge = chromeWsBridge;
    }

    // ── Terminal PTY WebSocket handler ──────────────────────────────────
    TerminalService.attach(terminalWss, assistant);

    // ── Event Broadcaster ───────────────────────────────────────────────
    const eventBroadcaster = new EventBroadcaster(wss, eventBus, assistant, agentLoopController);
    eventBroadcaster.initialize();

    // Local references for compatibility and usage in handlers
    const broadcast = eventBroadcaster.broadcast;
    const broadcastFileTree = eventBroadcaster.broadcastFileTree;

    // Load initial conversation if exists (after event bus is wired up)
    await assistant.loadConversation();

    // Fetch real model lists from provider APIs (non-blocking)
    fetchRemoteModels().catch(err => {
        consoleStyler.log('warning', `Initial model fetch failed: ${err.message}`);
    });

    // Build the message dispatcher
    const dispatcher = buildDispatcher();

    // ── Initialize Plugin Manager ──────────────────────────────────────
    if (assistant.pluginManager) {
        try {
            assistant.pluginManager.setWsDispatcher(dispatcher);
            assistant.pluginManager.setBroadcast(broadcast);
            await assistant.pluginManager.initialize();
            consoleStyler.log('plugin', 'Plugin system initialized');
        } catch (err) {
            consoleStyler.log('warning', `Plugin system initialization failed: ${err.message}`);
        }
    }

    // ── Auto-activate agent loop for headless / service mode ────────────
    if (process.env.OBOTO_AUTO_ACTIVATE === 'true' && agentLoopController) {
        const autoActivateDelay = parseInt(process.env.OBOTO_AUTO_ACTIVATE_DELAY || '3000', 10);
        setTimeout(() => {
            consoleStyler.log('ai', 'Auto-activating agent loop (OBOTO_AUTO_ACTIVATE=true)');
            agentLoopController.play().catch(err => {
                consoleStyler.log('error', `Auto-activate agent loop failed: ${err.message}`);
            });
        }, autoActivateDelay);
    }

    // ── Client Connection Handler ──────────────────────────────────────
    const clientHandler = new ClientConnectionHandler({
        wss,
        assistant,
        dispatcher,
        broadcast,
        broadcastFileTree,
        eventBus,
        agentLoopController,
        schedulerService,
        secretsManager,
        workspaceContentServer,
        cloudLoader,
        activeController
    });
    clientHandler.initialize();

    // ── Graceful shutdown cleanup ──────────────────────────────────────
    const shutdown = () => {
        eventBroadcaster.destroy();
        server.close();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    // Keep process alive
    return new Promise(() => {}); 
}
