import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import { consoleStyler } from '../ui/console-styler.mjs';
import { getRegistrySnapshot, fetchRemoteModels } from '../core/model-registry.mjs';
import { config } from '../config.mjs';
import { ChromeWsBridge } from './chrome-ws-bridge.mjs';

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

export async function startServer(assistant, workingDir, eventBus, port = 3000, schedulerService = null, secretsManager = null, agentLoopController = null) {
    const app = express();
    let activeController = null;
    
    // Serve static files from ui/dist
    // Assuming ui/dist is relative to the project root (workingDir)
    const uiDistPath = path.join(workingDir, 'ui', 'dist');
    
    if (fs.existsSync(uiDistPath)) {
        app.use(express.static(uiDistPath));
    } else {
        consoleStyler.log('warning', `UI build not found at ${uiDistPath}`);
        consoleStyler.log('warning', 'Please run "npm run build:ui" to build the web interface.');
        
        app.get('/', (req, res) => {
            res.send(`
                <html>
                    <body style="font-family: sans-serif; background: #111; color: #fff; padding: 2rem; text-align: center;">
                        <h1>RoboDev AI Server</h1>
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
        eventBus.on('task:failed', (data) => broadcast('task-failed', data));
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

        // Agent Loop Chat Integration — inject agent loop results into main chat
        eventBus.on('agent-loop:chat-message', (data) => {
            broadcast('message', data);
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
                timestamp: data.timestamp || new Date().toLocaleTimeString(),
                questionId: data.questionId,
                isAgentLoop: true
            });
        });
    }

    // Load initial conversation if exists (after event bus is wired up)
    await assistant.loadConversation();

    // Fetch real model lists from provider APIs (non-blocking)
    fetchRemoteModels().catch(err => {
        consoleStyler.log('warning', `Initial model fetch failed: ${err.message}`);
    });

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

        // Send current agent loop state to newly connected client
        if (agentLoopController) {
            try {
                ws.send(JSON.stringify({ type: 'agent-loop-state', payload: agentLoopController.getState() }));
            } catch (e) {
                // Ignore
            }
        }

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'chat') {
                    const userInput = data.payload;
                    const activeSurfaceId = data.surfaceId || null;
                    const modelOverride = data.model || null;
                    consoleStyler.log('user', `Web User: ${userInput}${activeSurfaceId ? ` [surface: ${activeSurfaceId}]` : ''}${modelOverride ? ` [model: ${modelOverride}]` : ''}`);
                    
                    // Simulate thinking
                    ws.send(JSON.stringify({ type: 'status', payload: 'working' }));

                    // Signal foreground activity to agent loop
                    if (agentLoopController) agentLoopController.setForegroundBusy(true);

                    // Cancel any previous active task
                    if (activeController) {
                        activeController.abort();
                    }
                    activeController = new AbortController();

                    // Build surface context prefix if a surface is focused
                    let surfaceContextInput = userInput;
                    if (activeSurfaceId && assistant.toolExecutor?.surfaceManager) {
                        try {
                            const surface = await assistant.toolExecutor.surfaceManager.getSurface(activeSurfaceId);
                            if (surface) {
                                const componentNames = surface.components.map(c => c.name).join(', ') || 'none';
                                let layoutDesc;
                                if (typeof surface.layout === 'object' && surface.layout?.type === 'flex-grid') {
                                    const cellIds = [];
                                    for (const row of surface.layout.rows) {
                                        for (const cell of row.cells) {
                                            cellIds.push(`${cell.id}[${cell.components.join(',') || 'empty'}]`);
                                        }
                                    }
                                    layoutDesc = `flex-grid(cells: ${cellIds.join(', ')})`;
                                } else {
                                    layoutDesc = surface.layout || 'vertical';
                                }
                                surfaceContextInput = `[Active Surface: "${surface.name}" (ID: ${activeSurfaceId}, layout: ${layoutDesc}, components: ${componentNames})]\n\n${userInput}`;
                            }
                        } catch (e) {
                            // Ignore surface lookup errors — proceed without context
                        }
                    }

                    // Run assistant
                    try {
                        const responseText = await assistant.run(surfaceContextInput, { signal: activeController.signal, model: modelOverride });
                        
                        // Send response back
                        ws.send(JSON.stringify({
                            type: 'message',
                            payload: {
                                id: Date.now().toString(),
                                role: 'ai',
                                type: 'text',
                                content: responseText,
                                timestamp: new Date().toLocaleTimeString()
                            }
                        }));

                        // Generate and broadcast next steps AFTER the response
                        await assistant.generateNextSteps();
                    } catch (err) {
                        if (err.name === 'AbortError' || err.message.includes('cancelled')) {
                            consoleStyler.log('system', 'Task execution cancelled by user');
                            ws.send(JSON.stringify({
                                type: 'message',
                                payload: {
                                    id: Date.now().toString(),
                                    role: 'ai',
                                    type: 'text',
                                    content: '🛑 Task cancelled.',
                                    timestamp: new Date().toLocaleTimeString()
                                }
                            }));
                        } else {
                            throw err; // Re-throw to be caught by outer catch
                        }
                    } finally {
                        activeController = null;
                        if (agentLoopController) agentLoopController.setForegroundBusy(false);
                        ws.send(JSON.stringify({ type: 'status', payload: 'idle' }));
                    }
                } else if (data.type === 'interrupt') {
                    consoleStyler.log('system', '🛑 Received interrupt signal — shutting down current request');
                    if (activeController) {
                        activeController.abort();
                        activeController = null;
                        consoleStyler.log('system', '🛑 AbortController fired — request pipeline will terminate');
                    } else {
                        consoleStyler.log('system', '🛑 No active request to interrupt');
                    }
                    // Always transition to idle and notify client
                    if (agentLoopController) agentLoopController.setForegroundBusy(false);
                    ws.send(JSON.stringify({ type: 'status', payload: 'idle' }));
                    // Broadcast an explicit "interrupted" log so the UI sees it in the activity feed
                    broadcast('log', { level: 'status', message: 'Request interrupted by user' });
                } else if (data.type === 'get-history') {
                    try {
                        const history = assistant.historyManager.getHistory();
                        const uiMessages = convertHistoryToUIMessages(history);
                        ws.send(JSON.stringify({ type: 'history-loaded', payload: uiMessages }));
                    } catch (err) {
                        consoleStyler.log('error', `Failed to get history: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: err.message }));
                    }
                } else if (data.type === 'delete-message') {
                    try {
                        const { id } = data.payload;
                        const deleted = assistant.historyManager.deleteMessage(id);
                        if (deleted) {
                            await assistant.saveConversation();
                            // Broadcast updated history to all clients
                            const history = assistant.historyManager.getHistory();
                            const uiMessages = convertHistoryToUIMessages(history);
                            broadcast('history-loaded', uiMessages);
                        }
                    } catch (err) {
                        consoleStyler.log('error', `Failed to delete message: ${err.message}`);
                    }
                } else if (data.type === 'get-status') {
                    try {
                        const info = await getProjectInfo(assistant.workingDir);
                        ws.send(JSON.stringify({ type: 'status-update', payload: info }));
                    } catch (err) {
                        consoleStyler.log('error', `Failed to get project info: ${err.message}`);
                    }
                } else if (data.type === 'set-cwd') {
                    try {
                        const newPath = data.payload;
                        const actualPath = await assistant.changeWorkingDirectory(newPath);
                        ws.send(JSON.stringify({ type: 'status', payload: `Changed working directory to ${actualPath}` }));
                        
                        // Push new status update immediately
                        const info = await getProjectInfo(actualPath);
                        ws.send(JSON.stringify({ type: 'status-update', payload: info }));

                        // Push updated file tree for the new workspace
                        const tree = await getDirectoryTree(actualPath, 2);
                        ws.send(JSON.stringify({ type: 'file-tree', payload: tree }));

                        // Switch scheduler to new workspace and restore its schedules
                        if (schedulerService) {
                            await schedulerService.switchWorkspace(actualPath);
                            const schedules = schedulerService.listSchedules();
                            broadcast('schedule-list', schedules);
                        }

                        // Refresh surfaces for the new workspace
                        if (assistant.toolExecutor?.surfaceManager) {
                            try {
                                const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                                ws.send(JSON.stringify({ type: 'surface-list', payload: surfaces }));
                            } catch (e) {
                                // New workspace may not have a .surfaces/ dir yet — send empty list
                                ws.send(JSON.stringify({ type: 'surface-list', payload: [] }));
                            }
                        } else {
                            // No surface manager — send empty list to clear stale state
                            ws.send(JSON.stringify({ type: 'surface-list', payload: [] }));
                        }

                        // Update OpenClaw config for new workspace
                        if (assistant.openClawManager) {
                             await assistant.openClawManager.restart(actualPath);
                             
                             // Send updated OpenClaw status
                             ws.send(JSON.stringify({
                                type: 'openclaw-status',
                                payload: {
                                    available: true,
                                    connected: assistant.openClawManager.client?.isConnected ?? false,
                                    mode: assistant.openClawManager.config.mode,
                                    url: assistant.openClawManager.config.url,
                                    path: assistant.openClawManager.config.path,
                                    authToken: assistant.openClawManager.config.authToken
                                }
                             }));
                        }
                    } catch (err) {
                        consoleStyler.log('error', `Failed to change directory: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: err.message }));
                    }
                } else if (data.type === 'get-settings') {
                    ws.send(JSON.stringify({
                        type: 'settings',
                        payload: {
                            maxTurns: assistant.maxTurns,
                            maxSubagents: assistant.maxSubagents,
                            ai: config.ai,
                            routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
                            modelRegistry: getRegistrySnapshot()
                        }
                    }));
                } else if (data.type === 'update-settings') {
                    const settings = data.payload;
                    if (settings.maxTurns) assistant.maxTurns = parseInt(settings.maxTurns, 10);
                    if (settings.maxSubagents) assistant.maxSubagents = parseInt(settings.maxSubagents, 10);

                    // Persist AI provider config to process.env + live config
                    if (settings.ai) {
                        const { provider, model, endpoint } = settings.ai;
                        if (provider) {
                            process.env.AI_PROVIDER = provider;
                            // Also update the in-memory config module
                            config.ai.provider = provider;
                        }
                        if (model) {
                            process.env.AI_MODEL = model;
                            config.ai.model = model;
                        }
                        if (endpoint) {
                            process.env.AI_ENDPOINT = endpoint;
                            config.ai.endpoint = endpoint;
                        }
                    }

                    // Update routing configuration
                    if (settings.routing) {
                        if (assistant.promptRouter) {
                            assistant.promptRouter.setRoutes(settings.routing);
                        }
                        // Update config and env vars for persistence
                        Object.assign(config.routing, settings.routing);
                        
                        if (settings.routing.agentic) process.env.ROUTE_AGENTIC = settings.routing.agentic;
                        if (settings.routing.reasoning_high) process.env.ROUTE_REASONING_HIGH = settings.routing.reasoning_high;
                        if (settings.routing.reasoning_medium) process.env.ROUTE_REASONING_MEDIUM = settings.routing.reasoning_medium;
                        if (settings.routing.reasoning_low) process.env.ROUTE_REASONING_LOW = settings.routing.reasoning_low;
                        if (settings.routing.summarizer) process.env.ROUTE_SUMMARIZER = settings.routing.summarizer;
                        if (settings.routing.code_completion) process.env.ROUTE_CODE_COMPLETION = settings.routing.code_completion;
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'status',
                        payload: 'Settings updated'
                    }));
                    
                    // Broadcast new settings back (include AI config)
                    ws.send(JSON.stringify({
                        type: 'settings',
                        payload: {
                            maxTurns: assistant.maxTurns,
                            maxSubagents: assistant.maxSubagents,
                            ai: config.ai,
                            routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
                            modelRegistry: getRegistrySnapshot()
                        }
                    }));
                } else if (data.type === 'get-files') {
                    try {
                        const targetDir = data.payload || assistant.workingDir;
                        const tree = await getDirectoryTree(targetDir, 2);
                        ws.send(JSON.stringify({ type: 'file-tree', payload: tree }));
                    } catch (err) {
                        consoleStyler.log('error', `Failed to get file tree: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: err.message }));
                    }
                } else if (data.type === 'read-file') {
                    try {
                        const filePath = data.payload;
                        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(assistant.workingDir, filePath);
                        const content = await fs.promises.readFile(fullPath, 'utf8');
                        ws.send(JSON.stringify({ type: 'file-content', payload: { path: filePath, content } }));
                    } catch (err) {
                        consoleStyler.log('error', `Failed to read file: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to read file: ${err.message}` }));
                    }
                } else if (data.type === 'list-dirs') {
                    try {
                        const targetDir = data.payload || '/';
                        const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
                        const dirs = entries
                            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
                            .map(e => e.name)
                            .sort((a, b) => a.localeCompare(b));
                        ws.send(JSON.stringify({ type: 'dir-list', payload: { path: targetDir, dirs } }));
                    } catch (err) {
                        consoleStyler.log('error', `Failed to list dirs: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to list dirs: ${err.message}` }));
                    }
                } else if (data.type === 'create-dir') {
                    try {
                        const dirPath = data.payload;
                        await fs.promises.mkdir(dirPath, { recursive: true });
                        ws.send(JSON.stringify({ type: 'dir-created', payload: dirPath }));
                        broadcastFileTree();
                    } catch (err) {
                        consoleStyler.log('error', `Failed to create dir: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to create dir: ${err.message}` }));
                    }
                } else if (data.type === 'delete-file') {
                    try {
                        const targetPath = data.payload;
                        const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(assistant.workingDir, targetPath);
                        await fs.promises.rm(fullPath, { recursive: true, force: true });
                        ws.send(JSON.stringify({ type: 'file-deleted', payload: targetPath }));
                        broadcastFileTree();
                    } catch (err) {
                        consoleStyler.log('error', `Failed to delete file/dir: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to delete: ${err.message}` }));
                    }
                } else if (data.type === 'copy-file') {
                    try {
                        const { source, destination } = data.payload;
                        const fullSource = path.isAbsolute(source) ? source : path.join(assistant.workingDir, source);
                        const fullDest = path.isAbsolute(destination) ? destination : path.join(assistant.workingDir, destination);
                        
                        await fs.promises.cp(fullSource, fullDest, { recursive: true });
                        ws.send(JSON.stringify({ type: 'file-copied', payload: { source, destination } }));
                        broadcastFileTree();
                    } catch (err) {
                        consoleStyler.log('error', `Failed to copy file/dir: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to copy: ${err.message}` }));
                    }
                } else if (data.type === 'upload-file') {
                    try {
                        const { name, data: fileData, encoding } = data.payload;
                        // Save to an uploads directory inside the workspace
                        const uploadsDir = path.join(assistant.workingDir, '.uploads');
                        await fs.promises.mkdir(uploadsDir, { recursive: true });
                        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
                        const destPath = path.join(uploadsDir, `${Date.now()}-${safeName}`);
                        const buffer = Buffer.from(fileData, encoding || 'base64');
                        await fs.promises.writeFile(destPath, buffer);
                        const relativePath = path.relative(assistant.workingDir, destPath);
                        ws.send(JSON.stringify({ type: 'file-uploaded', payload: { name: safeName, path: relativePath, size: buffer.length } }));
                        broadcastFileTree();
                    } catch (err) {
                        consoleStyler.log('error', `Failed to upload file: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to upload file: ${err.message}` }));
                    }
                } else if (data.type === 'run-tests') {
                    try {
                        const { command } = data.payload || {};
                        const testCommand = command || 'npx jest --json --no-coverage';
                        const cwd = assistant.workingDir;

                        consoleStyler.log('system', `Running tests: ${testCommand} in ${cwd}`);

                        // Send a status message so the UI knows tests are running
                        ws.send(JSON.stringify({
                            type: 'message',
                            payload: {
                                id: `test-run-${Date.now()}`,
                                role: 'ai',
                                type: 'text',
                                content: `🧪 Running tests: \`${testCommand}\`…`,
                                timestamp: new Date().toLocaleTimeString()
                            }
                        }));

                        // Split command for execFile
                        const parts = testCommand.split(/\s+/);
                        const bin = parts[0];
                        const args = parts.slice(1);

                        execFile(bin, args, { cwd, maxBuffer: 1024 * 1024 * 10, timeout: 120000 }, (error, stdout, stderr) => {
                            const exitCode = error ? (error.code || 1) : 0;
                            let testResults;

                            try {
                                // Jest --json prints JSON to stdout
                                const jestOutput = JSON.parse(stdout);
                                testResults = parseJestJsonOutput(jestOutput, testCommand, exitCode, stderr || stdout);
                            } catch {
                                // Fallback: couldn't parse JSON — send raw output
                                testResults = {
                                    suites: [],
                                    totalPassed: 0,
                                    totalFailed: exitCode ? 1 : 0,
                                    totalPending: 0,
                                    totalDuration: 0,
                                    testCommand,
                                    exitCode,
                                    rawOutput: stdout || stderr || 'No output captured'
                                };
                            }

                            ws.send(JSON.stringify({
                                type: 'test-results',
                                payload: testResults
                            }));
                        });
                    } catch (err) {
                        consoleStyler.log('error', `Failed to run tests: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to run tests: ${err.message}` }));
                    }
                } else if (data.type === 'save-file') {
                    try {
                        const { path: filePath, content } = data.payload;
                        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(assistant.workingDir, filePath);
                        // Ensure directory exists
                        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
                        await fs.promises.writeFile(fullPath, content, 'utf8');
                        ws.send(JSON.stringify({ type: 'file-saved', payload: { path: filePath } }));
                        broadcastFileTree();
                    } catch (err) {
                        consoleStyler.log('error', `Failed to save file: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to save file: ${err.message}` }));
                    }
                } else if (data.type === 'openclaw-status') {
                    const manager = assistant?.openClawManager;
                    ws.send(JSON.stringify({
                        type: 'openclaw-status',
                        payload: {
                            available: !!manager,
                            connected: manager?.client?.isConnected ?? false,
                            mode: manager?.config?.mode ?? null,
                            url: manager?.config?.url ?? null,
                            path: manager?.config?.path ?? null,
                            authToken: manager?.config?.authToken ?? null
                        }
                    }));
                } else if (data.type === 'openclaw-config') {
                    const manager = assistant?.openClawManager;
                    if (manager) {
                        try {
                            const { restart, scope, ...config } = data.payload;
                            await manager.setConfig(config, scope, assistant.workingDir);
                            if (restart) {
                                await manager.restart(assistant.workingDir);
                            }
                            
                            // Send updated status
                            ws.send(JSON.stringify({
                                type: 'openclaw-status',
                                payload: {
                                    available: !!manager,
                                    connected: manager?.client?.isConnected ?? false,
                                    mode: manager?.config?.mode ?? null,
                                    url: manager?.config?.url ?? null,
                                    path: manager?.config?.path ?? null,
                                    authToken: manager?.config?.authToken ?? null
                                }
                            }));
                            ws.send(JSON.stringify({ type: 'status', payload: 'OpenClaw configuration updated' }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to update OpenClaw config: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'OpenClaw Manager not available' }));
                    }
                } else if (data.type === 'openclaw-deploy') {
                    const manager = assistant?.openClawManager;
                    if (manager) {
                        try {
                            if (data.payload) {
                                manager.setConfig(data.payload);
                            }
                            
                            ws.send(JSON.stringify({ type: 'status', payload: 'Installing OpenClaw...' }));
                            // Install first
                            await manager.install();

                            ws.send(JSON.stringify({ type: 'status', payload: 'Deploying OpenClaw...' }));
                            manager.setConfig({ mode: 'integrated' });
                            await manager.restart();
                            
                            // Send updated status
                            ws.send(JSON.stringify({
                                type: 'openclaw-status',
                                payload: {
                                    available: !!manager,
                                    connected: manager?.client?.isConnected ?? false,
                                    mode: manager?.config?.mode ?? null,
                                    url: manager?.config?.url ?? null,
                                    path: manager?.config?.path ?? null,
                                    authToken: manager?.config?.authToken ?? null
                                }
                            }));
                            ws.send(JSON.stringify({ type: 'status', payload: 'OpenClaw deployed' }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to deploy OpenClaw: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'OpenClaw Manager not available' }));
                    }
                } else if (data.type === 'code-completion-request') {
                    const { id, payload } = data;
                    try {
                        // Delegate to assistant
                        // If method doesn't exist yet, return null
                        const completion = assistant.generateCodeCompletion 
                            ? await assistant.generateCodeCompletion(payload.content, payload.cursorOffset, payload.filePath)
                            : null;
                            
                        ws.send(JSON.stringify({
                            type: 'code-completion-response',
                            id,
                            payload: { completion }
                        }));
                    } catch (e) {
                         ws.send(JSON.stringify({
                            type: 'code-completion-response',
                            id,
                            payload: { completion: null }
                        }));
                    }
                } else if (data.type === 'refresh-models') {
                    // Re-fetch model lists from provider APIs
                    try {
                        await fetchRemoteModels();
                        // Broadcast updated settings with new model registry to all clients
                        const settingsPayload = {
                            maxTurns: assistant.maxTurns,
                            maxSubagents: assistant.maxSubagents,
                            ai: config.ai,
                            routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
                            modelRegistry: getRegistrySnapshot()
                        };
                        broadcast('settings', settingsPayload);
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'error', payload: `Failed to refresh models: ${err.message}` }));
                    }
                }

                // --- Secrets Manager Handlers ---
                else if (data.type === 'get-secrets') {
                    if (secretsManager) {
                        const secrets = secretsManager.list();
                        ws.send(JSON.stringify({
                            type: 'secrets-list',
                            payload: {
                                secrets,
                                categories: secretsManager.getCategories()
                            }
                        }));
                    } else {
                        // Send an empty secrets-list so the UI exits the loading state
                        ws.send(JSON.stringify({
                            type: 'secrets-list',
                            payload: { secrets: [], categories: [] }
                        }));
                    }
                }
                else if (data.type === 'set-secret') {
                    if (secretsManager) {
                        try {
                            const { name, value, category, description } = data.payload;
                            await secretsManager.set(name, value, category, description);
                            ws.send(JSON.stringify({
                                type: 'secret-set',
                                payload: { name, success: true }
                            }));
                        } catch (err) {
                            consoleStyler.log('error', `Failed to set secret: ${err.message}`);
                            ws.send(JSON.stringify({
                                type: 'error',
                                payload: `Failed to set secret: ${err.message}`
                            }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Secrets manager not available' }));
                    }
                }
                else if (data.type === 'delete-secret') {
                    if (secretsManager) {
                        try {
                            const { name } = data.payload;
                            const deleted = await secretsManager.delete(name);
                            ws.send(JSON.stringify({
                                type: 'secret-deleted',
                                payload: {
                                    name,
                                    success: deleted,
                                    reason: deleted ? undefined : 'Secret not found in vault'
                                }
                            }));
                        } catch (err) {
                            consoleStyler.log('error', `Failed to delete secret: ${err.message}`);
                            ws.send(JSON.stringify({
                                type: 'error',
                                payload: `Failed to delete secret: ${err.message}`
                            }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Secrets manager not available' }));
                    }
                }
                
                // --- Task Manager & Scheduler Handlers ---
                else if (assistant.taskManager) {
                    if (data.type === 'get-tasks') {
                        const { status_filter } = data.payload || {};
                        const tasks = assistant.taskManager.listTasks(status_filter);
                        // Strip huge output logs for list view
                        const simplified = tasks.map(t => ({
                            ...t,
                            outputLog: undefined, // Don't send full logs in list
                            abortController: undefined // Not serializable
                        }));
                        ws.send(JSON.stringify({ type: 'task-list', payload: simplified }));
                        
                    } else if (data.type === 'get-task-output') {
                        const { task_id, since_index } = data.payload;
                        const logs = assistant.taskManager.getTaskOutput(task_id, since_index || 0);
                        ws.send(JSON.stringify({ type: 'task-output-history', payload: { taskId: task_id, logs } }));
                        
                    } else if (data.type === 'cancel-task') {
                        const { task_id } = data.payload;
                        const success = assistant.taskManager.cancelTask(task_id);
                        if (!success) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to cancel task ${task_id}` }));
                        }
                    }
                }

                if (schedulerService) {
                    if (data.type === 'get-schedules') {
                        const schedules = schedulerService.listSchedules(data.payload?.status_filter);
                        ws.send(JSON.stringify({ type: 'schedule-list', payload: schedules }));
                        
                    } else if (data.type === 'pause-schedule') {
                        schedulerService.pauseSchedule(data.payload.schedule_id);
                        
                    } else if (data.type === 'resume-schedule') {
                        schedulerService.resumeSchedule(data.payload.schedule_id);
                        
                    } else if (data.type === 'delete-schedule') {
                        schedulerService.deleteSchedule(data.payload.schedule_id);
                        
                    } else if (data.type === 'trigger-schedule') {
                        schedulerService.triggerNow(data.payload.schedule_id);
                    }
                }

                // --- Agent Loop Handlers ---
                if (agentLoopController) {
                    if (data.type === 'agent-loop-play') {
                        const intervalMs = data.payload?.intervalMs;
                        agentLoopController.play(intervalMs);
                    } else if (data.type === 'agent-loop-pause') {
                        agentLoopController.pause();
                    } else if (data.type === 'agent-loop-stop') {
                        agentLoopController.stop();
                    } else if (data.type === 'agent-loop-set-interval') {
                        const intervalMs = data.payload?.intervalMs;
                        if (intervalMs) agentLoopController.setInterval(intervalMs);
                    } else if (data.type === 'get-agent-loop-state') {
                        ws.send(JSON.stringify({ type: 'agent-loop-state', payload: agentLoopController.getState() }));
                    } else if (data.type === 'agent-loop-answer') {
                        // User is answering a blocking question from the background agent
                        const { questionId, answer } = data.payload;
                        if (questionId && answer) {
                            agentLoopController.resolveQuestion(questionId, answer);
                            ws.send(JSON.stringify({ type: 'status', payload: 'Answer sent to background agent' }));
                        } else {
                            ws.send(JSON.stringify({ type: 'error', payload: 'Missing questionId or answer' }));
                        }
                    }
                } else if (data.type === 'get-agent-loop-state') {
                    // Return a disabled state if no controller exists
                    ws.send(JSON.stringify({ type: 'agent-loop-state', payload: { state: 'stopped', intervalMs: 180000, invocationCount: 0, pendingQuestions: [] } }));
                }

                // --- UI Style Handlers (user-initiated from client) ---
                if (data.type === 'set-ui-theme') {
                    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
                    if (uiStyleHandlers) {
                        try {
                            await uiStyleHandlers.setUITheme(data.payload);
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: { message: `Theme error: ${err.message}` } }));
                        }
                    }
                }
                else if (data.type === 'set-ui-tokens') {
                    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
                    if (uiStyleHandlers) {
                        try {
                            await uiStyleHandlers.setUITokens(data.payload);
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: { message: `Token error: ${err.message}` } }));
                        }
                    }
                }
                else if (data.type === 'reset-ui-style') {
                    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
                    if (uiStyleHandlers) {
                        try {
                            await uiStyleHandlers.resetUIStyle();
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: { message: `Reset error: ${err.message}` } }));
                        }
                    }
                }
                else if (data.type === 'get-ui-style-state') {
                    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
                    if (uiStyleHandlers) {
                        const state = await uiStyleHandlers.getUIStyleState();
                        ws.send(JSON.stringify({ type: 'ui-style-state', payload: JSON.parse(state) }));
                    }
                }

                // --- Surface Handlers (independent if-blocks, NOT chained to scheduler) ---
                if (data.type === 'get-surfaces') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                            ws.send(JSON.stringify({ type: 'surface-list', payload: surfaces }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to list surfaces: ${err.message}` }));
                        }
                    }
                }
                else if (data.type === 'get-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { id } = data.payload;
                            const surface = await assistant.toolExecutor.surfaceManager.getSurface(id);
                            
                            if (surface) {
                                // Load sources for all components
                                const sources = {};
                                for (const comp of surface.components) {
                                    const source = await assistant.toolExecutor.surfaceManager.getComponentSource(id, comp.name);
                                    if (source) {
                                        sources[comp.id] = source;
                                    }
                                }
                                ws.send(JSON.stringify({ type: 'surface-data', payload: { surface, sources } }));
                            } else {
                                ws.send(JSON.stringify({ type: 'error', payload: `Surface ${id} not found` }));
                            }
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to get surface: ${err.message}` }));
                        }
                    }
                }
                else if (data.type === 'create-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { name, description, layout } = data.payload;
                            const surface = await assistant.toolExecutor.surfaceManager.createSurface(name, description || '', layout || 'vertical');
                            // Broadcast to ALL clients via event bus
                            if (eventBus) {
                                eventBus.emit('surface:created', surface);
                            }
                            // Also send confirmation back to the sender
                            ws.send(JSON.stringify({ type: 'surface-created', payload: surface }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to create surface: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'update-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id, component_name, jsx_source, props, order } = data.payload;
                            const surface = await assistant.toolExecutor.surfaceManager.updateComponent(
                                surface_id, component_name, jsx_source, props || {}, order ?? null
                            );
                            const component = surface.components.find(c => c.name === component_name);
                            // Broadcast to ALL clients via event bus
                            // Include layout so auto-placement changes are reflected
                            if (eventBus) {
                                eventBus.emit('surface:updated', {
                                    surfaceId: surface_id,
                                    component,
                                    source: jsx_source,
                                    layout: surface.layout
                                });
                            }
                            ws.send(JSON.stringify({ type: 'surface-updated', payload: { surfaceId: surface_id, component, source: jsx_source, layout: surface.layout } }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to update surface: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'delete-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id } = data.payload;
                            await assistant.toolExecutor.surfaceManager.deleteSurface(surface_id);
                            // Broadcast to ALL clients via event bus
                            if (eventBus) {
                                eventBus.emit('surface:deleted', { surfaceId: surface_id });
                            }
                            ws.send(JSON.stringify({ type: 'surface-deleted', payload: { surfaceId: surface_id } }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to delete surface: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'pin-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id } = data.payload;
                            const pinned = await assistant.toolExecutor.surfaceManager.togglePin(surface_id);
                            // Refresh the surface list for all clients
                            const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                            broadcast('surface-list', surfaces);
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to toggle pin: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'rename-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id, name } = data.payload;
                            const surface = await assistant.toolExecutor.surfaceManager.renameSurface(surface_id, name);
                            // Refresh the surface list for all clients
                            const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                            broadcast('surface-list', surfaces);
                            // Also send the updated surface data if it's loaded
                            ws.send(JSON.stringify({ type: 'surface-renamed', payload: { surfaceId: surface_id, name } }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to rename surface: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'duplicate-surface') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id, name } = data.payload;
                            const duplicate = await assistant.toolExecutor.surfaceManager.duplicateSurface(surface_id, name);
                            // Broadcast to ALL clients via event bus
                            if (eventBus) {
                                eventBus.emit('surface:created', duplicate);
                            }
                            ws.send(JSON.stringify({ type: 'surface-created', payload: duplicate }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to duplicate surface: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'remove-surface-component') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id, component_name } = data.payload;
                            const success = await assistant.toolExecutor.surfaceManager.removeComponent(surface_id, component_name);
                            if (success) {
                                if (eventBus) {
                                    eventBus.emit('surface:updated', {
                                        surfaceId: surface_id,
                                        component: { name: component_name, deleted: true }
                                    });
                                }
                            }
                            ws.send(JSON.stringify({ type: 'surface-component-removed', payload: { surface_id, component_name, success } }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to remove component: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'update-surface-layout') {
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const { surface_id, layout } = data.payload;
                            const surface = await assistant.toolExecutor.surfaceManager.updateLayout(surface_id, layout);
                            if (eventBus) {
                                eventBus.emit('surface:layout-updated', { surfaceId: surface_id, layout: surface.layout });
                            }
                            ws.send(JSON.stringify({ type: 'surface-layout-updated', payload: { surfaceId: surface_id, layout: surface.layout } }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to update surface layout: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
                    }
                }
                else if (data.type === 'surface-agent-request') {
                    const { requestId, prompt } = data.payload;
                    try {
                        const response = await assistant.run(`[Surface Request] ${prompt}`, { isRetry: false });
                        ws.send(JSON.stringify({
                            type: 'surface-agent-response',
                            payload: { requestId, response }
                        }));
                    } catch (err) {
                        ws.send(JSON.stringify({
                            type: 'surface-agent-response',
                            payload: { requestId, response: `Error: ${err.message}` }
                        }));
                    }
                }
                else if (data.type === 'surface-handler-invoke') {
                    const { requestId, surfaceId, handlerName, handlerDefinition, args } = data.payload;
                    try {
                        // Build structured prompt with JSON schema enforcement
                        const schemaStr = JSON.stringify(handlerDefinition.outputSchema, null, 2);
                        const argsStr = Object.keys(args).length > 0 ? JSON.stringify(args) : 'none';
                        
                        let surfaceContext = '';
                        if (surfaceId && assistant.toolExecutor?.surfaceManager) {
                            try {
                                const surface = await assistant.toolExecutor.surfaceManager.getSurface(surfaceId);
                                if (surface) {
                                    surfaceContext = `\nSurface: "${surface.name}" (ID: ${surfaceId})`;
                                }
                            } catch (_) { /* ignore */ }
                        }

                        const structuredPrompt = `[Surface Handler Request]${surfaceContext}
Handler: ${handlerName} (${handlerDefinition.type})
Description: ${handlerDefinition.description}
Input: ${argsStr}

You MUST respond with ONLY a valid JSON object matching this exact schema:
${schemaStr}

CRITICAL RULES:
- Return ONLY the JSON object. No text before or after.
- Do NOT wrap in markdown code blocks.
- Use your available tools to gather any information needed, then return the JSON result.
- All required fields in the schema MUST be present in your response.`;

                        const response = await assistant.run(structuredPrompt, { isRetry: false });
                        
                        // Extract JSON from the response (strip markdown fences if present)
                        let jsonData;
                        try {
                            // Try direct parse first
                            jsonData = JSON.parse(response);
                        } catch (_) {
                            // Try stripping markdown code fences
                            const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
                            if (fenceMatch) {
                                jsonData = JSON.parse(fenceMatch[1].trim());
                            } else {
                                // Try finding first { to last }
                                const firstBrace = response.indexOf('{');
                                const lastBrace = response.lastIndexOf('}');
                                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                                    jsonData = JSON.parse(response.substring(firstBrace, lastBrace + 1));
                                } else {
                                    throw new Error('Could not extract JSON from AI response');
                                }
                            }
                        }

                        ws.send(JSON.stringify({
                            type: 'surface-handler-result',
                            payload: { requestId, success: true, data: jsonData, error: null }
                        }));
                    } catch (err) {
                        ws.send(JSON.stringify({
                            type: 'surface-handler-result',
                            payload: { requestId, success: false, data: null, error: err.message }
                        }));
                    }
                }
                else if (data.type === 'surface-get-state') {
                    const { requestId, surfaceId, key } = data.payload;
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            const surface = await assistant.toolExecutor.surfaceManager.getSurface(surfaceId);
                            const value = surface?.state?.[key];
                            ws.send(JSON.stringify({
                                type: 'surface-state-data',
                                payload: { requestId, value }
                            }));
                        } catch (err) {
                            ws.send(JSON.stringify({
                                type: 'surface-state-data',
                                payload: { requestId, value: undefined }
                            }));
                        }
                    } else {
                        ws.send(JSON.stringify({
                            type: 'surface-state-data',
                            payload: { requestId, value: undefined }
                        }));
                    }
                }
                else if (data.type === 'surface-set-state') {
                    const { surfaceId, key, value } = data.payload;
                    if (assistant.toolExecutor?.surfaceManager) {
                        try {
                            await assistant.toolExecutor.surfaceManager.setSurfaceState(surfaceId, key, value);
                            ws.send(JSON.stringify({
                                type: 'surface-state-saved',
                                payload: { surfaceId, key, success: true }
                            }));
                        } catch (err) {
                            ws.send(JSON.stringify({
                                type: 'surface-state-saved',
                                payload: { surfaceId, key, success: false, error: err.message }
                            }));
                        }
                    }
                }
                else if (data.type === 'screenshot-captured') {
                    const { requestId, image, error } = data.payload;
                    if (eventBus) {
                        eventBus.emit('surface:screenshot-captured', { requestId, image, error });
                    }
                }
                // --- Workflow Handlers (BubbleLab integration) ---
                else if (data.type === 'start-workflow') {
                    const workflowService = assistant.toolExecutor?.workflowService;
                    if (workflowService) {
                        try {
                            const { surfaceId, flowScript, flowName } = data.payload;
                            const result = await workflowService.startWorkflow(surfaceId, flowScript, flowName);
                            ws.send(JSON.stringify({ type: 'workflow-started', payload: result }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to start workflow: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
                    }
                }
                else if (data.type === 'submit-interaction') {
                    const workflowService = assistant.toolExecutor?.workflowService;
                    if (workflowService) {
                        try {
                            const { workflowId, interactionId, data: interactionData } = data.payload;
                            const result = await workflowService.submitInteraction(workflowId, interactionId, interactionData);
                            ws.send(JSON.stringify({ type: 'workflow-interaction-submitted', payload: result }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to submit interaction: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
                    }
                }
                else if (data.type === 'cancel-workflow') {
                    const workflowService = assistant.toolExecutor?.workflowService;
                    if (workflowService) {
                        try {
                            const { workflowId } = data.payload;
                            const result = await workflowService.cancelWorkflow(workflowId);
                            ws.send(JSON.stringify({ type: 'workflow-cancelled', payload: result }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to cancel workflow: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
                    }
                }
                else if (data.type === 'get-workflow-status') {
                    const workflowService = assistant.toolExecutor?.workflowService;
                    if (workflowService) {
                        try {
                            const { workflowId } = data.payload;
                            const status = await workflowService.getWorkflowStatus(workflowId);
                            ws.send(JSON.stringify({ type: 'workflow-status', payload: status }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to get workflow status: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
                    }
                }
                else if (data.type === 'list-workflows') {
                    const workflowService = assistant.toolExecutor?.workflowService;
                    if (workflowService) {
                        try {
                            const result = await workflowService.listWorkflows();
                            ws.send(JSON.stringify({ type: 'workflow-list', payload: result }));
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'error', payload: `Failed to list workflows: ${err.message}` }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'workflow-list', payload: [] }));
                    }
                }
                else if (data.type === 'tool-confirmation-response') {
                    const { id, decision } = data.payload;
                    if (assistant.toolExecutor) {
                        assistant.toolExecutor.resolveConfirmation(id, decision);
                    }
                }

            } catch (error) {
                consoleStyler.log('error', `WebSocket error: ${error.message}`);
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: error.message
                }));
            }
        });

        ws.on('close', () => {
            consoleStyler.log('system', 'Client disconnected');
        });
    });

    // Keep process alive
    return new Promise(() => {}); 
}

async function getProjectInfo(dir) {
    let fileCount = 0;
    let projectType = 'Unknown';
    let gitBranch = null;

    // Count files (simple recursive)
    async function countFiles(d) {
        try {
            const entries = await fs.promises.readdir(d, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next' || entry.name === 'target') continue;
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    await countFiles(fullPath);
                } else {
                    fileCount++;
                }
            }
        } catch (e) {
             // Ignore errors
        }
    }
    await countFiles(dir);

    // Project Type
    if (fs.existsSync(path.join(dir, 'package.json'))) projectType = 'Node.js';
    else if (fs.existsSync(path.join(dir, 'requirements.txt'))) projectType = 'Python';
    else if (fs.existsSync(path.join(dir, 'pom.xml'))) projectType = 'Java';
    else if (fs.existsSync(path.join(dir, 'Cargo.toml'))) projectType = 'Rust';
    else if (fs.existsSync(path.join(dir, 'go.mod'))) projectType = 'Go';
    else if (fs.existsSync(path.join(dir, 'composer.json'))) projectType = 'PHP';
    else if (fs.existsSync(path.join(dir, 'Gemfile'))) projectType = 'Ruby';

    // Git Branch
    try {
        const gitHeadPath = path.join(dir, '.git', 'HEAD');
        if (fs.existsSync(gitHeadPath)) {
            const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
            if (headContent.startsWith('ref: refs/heads/')) {
                gitBranch = headContent.replace('ref: refs/heads/', '');
            } else {
                gitBranch = headContent.substring(0, 7);
            }
        }
    } catch (e) {}

    // Parse Structured Development manifest (SYSTEM_MAP.md) if present
    let structuredDev = null;
    const manifestPath = path.join(dir, 'SYSTEM_MAP.md');
    if (fs.existsSync(manifestPath)) {
        try {
            const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
            structuredDev = parseManifestForUI(manifestContent);
        } catch (e) {
            // Ignore parse errors
        }
    }

    return { cwd: dir, fileCount, projectType, gitBranch, structuredDev };
}

/**
 * Parse the SYSTEM_MAP.md manifest and extract feature/invariant data for the UI.
 * Returns a structured object with features, invariants, and summary counts.
 */
function parseManifestForUI(manifestContent) {
    const features = [];
    const invariants = [];
    let lastUpdated = null;

    // Extract last updated timestamp
    const lastUpdatedMatch = manifestContent.match(/Last Updated:\s*(.+)/);
    if (lastUpdatedMatch) {
        lastUpdated = lastUpdatedMatch[1].trim();
    }

    // Parse Feature Registry table
    // Format: | Feature ID | Name | Status | Phase | Lock Level | Priority | Dependencies |
    const registryMatch = manifestContent.match(/## 2\. Feature Registry([\s\S]*?)(?=## 3|$)/);
    if (registryMatch) {
        const lines = registryMatch[1].trim().split('\n');
        for (const line of lines) {
            if (!line.trim().startsWith('|')) continue;
            if (line.includes('Feature ID') || line.includes('---')) continue;

            const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            if (cols.length >= 4) {
                // Pad missing columns
                while (cols.length < 7) cols.push('-');
                features.push({
                    id: cols[0],
                    name: cols[1],
                    status: cols[2],
                    phase: cols[3],
                    lockLevel: cols[4],
                    priority: cols[5],
                    dependencies: cols[6]
                });
            }
        }
    }

    // Parse Global Invariants table
    // Format: | ID | Invariant | Description |
    const invariantsMatch = manifestContent.match(/## 1\. Global Invariants([\s\S]*?)(?=## 2|$)/);
    if (invariantsMatch) {
        const lines = invariantsMatch[1].trim().split('\n');
        for (const line of lines) {
            if (!line.trim().startsWith('|')) continue;
            if (line.includes('| ID') || line.includes('---')) continue;

            const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            if (cols.length >= 2) {
                while (cols.length < 3) cols.push('-');
                invariants.push({
                    id: cols[0],
                    name: cols[1],
                    description: cols[2]
                });
            }
        }
    }

    // Parse State Snapshots for recent activity
    const snapshots = [];
    const snapshotsMatch = manifestContent.match(/## 4\. State Snapshots([\s\S]*?)$/);
    if (snapshotsMatch) {
        const lines = snapshotsMatch[1].trim().split('\n');
        for (const line of lines) {
            const snapshotMatch = line.match(/^-\s*\[(.+?)\]\s*(.+)/);
            if (snapshotMatch) {
                snapshots.push({
                    timestamp: snapshotMatch[1],
                    description: snapshotMatch[2]
                });
            }
        }
    }

    // Compute summary
    const totalFeatures = features.length;
    const completedFeatures = features.filter(f => f.status === 'Completed' || f.status === 'Locked' || f.phase === 'Locked').length;
    const remainingFeatures = totalFeatures - completedFeatures;

    // Phase breakdown
    const phaseBreakdown = {};
    for (const f of features) {
        const phase = f.phase || 'Unknown';
        phaseBreakdown[phase] = (phaseBreakdown[phase] || 0) + 1;
    }

    return {
        hasManifest: true,
        lastUpdated,
        features,
        invariants,
        snapshots: snapshots.slice(-5), // Last 5 snapshots
        totalFeatures,
        completedFeatures,
        remainingFeatures,
        phaseBreakdown
    };
}

/**
 * Convert raw OpenAI-format conversation history to UI Message format.
 * The conversation file stores messages as {role: "user"|"assistant"|"system"|"tool", content, tool_calls},
 * but the UI expects {id, role: "user"|"ai", type: "text"|"tool-call"|etc, content, timestamp}.
 *
 * BUG FIX: Group tool calls with their parent assistant message instead of emitting them as separate messages.
 * This prevents massive vertical space usage on reload.
 */
function convertHistoryToUIMessages(history) {
    if (!Array.isArray(history)) return [];
    
    const uiMessages = [];
    let msgCounter = 0;
    
    // First pass: build a map of tool_call_id → tool result content
    const toolResultMap = {};
    for (const msg of history) {
        if (msg.role === 'tool' && msg.tool_call_id) {
            toolResultMap[msg.tool_call_id] = msg.content;
        }
    }
    
    for (const msg of history) {
        // Skip system messages and tool result messages (handled via pairing)
        if (msg.role === 'system' || msg.role === 'tool') continue;
        
        msgCounter++;
        const baseId = msg.id || `hist-${msgCounter}-${Date.now()}`;
        
        if (msg.role === 'user') {
            let userContent = msg.content || '';
            uiMessages.push({
                id: baseId,
                role: 'user',
                type: 'text',
                content: userContent,
                timestamp: ''
            });
        } else if (msg.role === 'assistant') {
            const uiMsg = {
                id: baseId,
                role: 'ai',
                type: 'text',
                content: msg.content || '',
                timestamp: '',
                toolCalls: []
            };

            // If this message has tool calls, group them into the toolCalls array
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    let parsedArgs;
                    try {
                        parsedArgs = typeof tc.function.arguments === 'string' 
                            ? JSON.parse(tc.function.arguments) 
                            : tc.function.arguments;
                    } catch {
                        parsedArgs = tc.function.arguments;
                    }
                    
                    // Look up the paired tool result
                    const pairedResult = tc.id ? toolResultMap[tc.id] : undefined;
                    
                    uiMsg.toolCalls.push({
                        toolName: tc.function.name,
                        args: parsedArgs,
                        result: pairedResult
                    });
                }
            }
            
            // Special case: If content is empty but we have tool calls, mark it as 'background-tasks'
            // so the UI renders it as a task block instead of an empty text bubble with attached tools.
            // This aligns better with the live behavior.
            if ((!uiMsg.content || uiMsg.content.trim() === '') && uiMsg.toolCalls.length > 0) {
                 uiMsg.type = 'background-tasks';
                 uiMsg.tasks = uiMsg.toolCalls.map(tc => ({
                     name: tc.toolName,
                     status: 'completed',
                     progress: 100,
                     logs: tc.result ? [typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)] : []
                 }));
                 // Remove the text-specific fields
                 delete uiMsg.content;
                 delete uiMsg.toolCalls;
            }

            uiMessages.push(uiMsg);
        }
    }
    
    return uiMessages;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.snapshots', '__pycache__', '.cache']);

async function getDirectoryTree(dir, maxDepth = 2, currentDepth = 0) {
    const result = [];
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        // Sort: directories first, then files, alphabetically within each group
        const sorted = entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
            if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.example') continue;
            if (IGNORED_DIRS.has(entry.name)) continue;

            const isDir = entry.isDirectory();
            const node = { name: entry.name, type: isDir ? 'directory' : 'file' };

            if (isDir && currentDepth < maxDepth) {
                node.children = await getDirectoryTree(path.join(dir, entry.name), maxDepth, currentDepth + 1);
            } else if (isDir) {
                node.children = []; // collapsed
            }

            result.push(node);
        }
    } catch (e) {
        // Ignore permission errors
    }
    return result;
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

/**
 * Parse Jest JSON output (from --json flag) into our TestResults structure.
 * Jest JSON format: { numPassedTests, numFailedTests, numPendingTests, testResults: [...] }
 * Each testResult: { testFilePath, testResults: [{ title, status, duration, failureMessages }] }
 */
function parseJestJsonOutput(jestJson, testCommand, exitCode, rawOutput) {
    const suites = (jestJson.testResults || []).map(suiteResult => {
        const tests = (suiteResult.testResults || suiteResult.assertionResults || []).map(t => ({
            name: t.fullName || t.title || t.ancestorTitles?.join(' > ') + ' > ' + t.title || 'Unknown',
            status: t.status === 'passed' ? 'passed'
                  : t.status === 'failed' ? 'failed'
                  : t.status === 'pending' || t.status === 'todo' ? 'pending'
                  : 'skipped',
            duration: t.duration || 0,
            failureMessage: t.failureMessages?.length ? t.failureMessages.join('\n') : undefined
        }));

        return {
            name: suiteResult.testFilePath || suiteResult.name || 'Unknown Suite',
            tests,
            passed: tests.filter(t => t.status === 'passed').length,
            failed: tests.filter(t => t.status === 'failed').length,
            pending: tests.filter(t => t.status === 'pending' || t.status === 'skipped').length,
            duration: suiteResult.perfStats
                ? suiteResult.perfStats.end - suiteResult.perfStats.start
                : tests.reduce((sum, t) => sum + t.duration, 0)
        };
    });

    return {
        suites,
        totalPassed: jestJson.numPassedTests || 0,
        totalFailed: jestJson.numFailedTests || 0,
        totalPending: jestJson.numPendingTests || 0,
        totalDuration: jestJson.testResults
            ? jestJson.testResults.reduce((sum, s) => {
                  if (s.perfStats) return sum + (s.perfStats.end - s.perfStats.start);
                  return sum;
              }, 0)
            : 0,
        testCommand,
        exitCode,
        rawOutput: rawOutput || undefined
    };
}
