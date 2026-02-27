// Main entry point for the AI Assistant
// Orchestrates CLI interface and AI assistant initialization

import { EventicFacade as MiniAIAssistant } from './core/eventic-facade.mjs';
import { CLIInterface } from './cli/cli-interface.mjs';
import { AiManEventBus } from './lib/event-bus.mjs';
import { consoleStyler } from './ui/console-styler.mjs';
import { TaskManager } from './core/task-manager.mjs';
import { SchedulerService } from './core/scheduler-service.mjs';
import { AgentLoopController } from './core/agent-loop-controller.mjs';
import { TaskCheckpointManager } from './core/task-checkpoint-manager.mjs';
import { OpenClawManager } from './integration/openclaw/manager.mjs';
import { SecretsManager } from './server/secrets-manager.mjs';
import { WorkspaceContentServer } from './server/workspace-content-server.mjs';
import { runMigrations } from './lib/migrate-config-dirs.mjs';

let _globalEventBus = null;

// Main execution function
async function main() {
    const cli = new CLIInterface();
    const eventBus = new AiManEventBus();
    _globalEventBus = eventBus;
    const workspaceContentServer = new WorkspaceContentServer();
    let openClawManager = null; // Lift scope
    
    try {
        // Set up signal handlers for graceful shutdown
        cli.setupSignalHandlers();
        
        // Parse command line arguments
        const { args, workingDir, isInteractive, userInput, resume, isServer } = cli.parseArguments();
        
        // Migrate legacy config directories (.ai-man → .oboto, ~/.oboto-service → ~/.oboto)
        runMigrations(workingDir);

        // Load secrets early so vault values override .env before config is consumed
        const secretsManager = new SecretsManager();
        await secretsManager.load();
        secretsManager.applyToEnv();

        // Start Workspace Content Server
        try {
            await workspaceContentServer.start(workingDir);
        } catch (e) {
            consoleStyler.log('warning', `Failed to start workspace content server: ${e.message}`);
        }

        // Display startup information
        cli.displayStartupInfo(workingDir);
        
        let statusAdapter;
        if (isServer) {
            const { ServerStatusAdapter } = await import('./server/server-status-adapter.mjs');
            statusAdapter = new ServerStatusAdapter(eventBus);

            // Forward ALL consoleStyler logs to the eventBus so they reach the client via WebSocket
            consoleStyler.setListener({
                log: (type, content, _options) => {
                    eventBus.emitTyped('server:log', { level: type, message: typeof content === 'string' ? content : String(content) });
                }
            });
        }

        // Initialize Task Manager
        const taskManager = new TaskManager(eventBus);

        // Initialize OpenClaw Manager
        openClawManager = new OpenClawManager(secretsManager); // Assign to lifted var
        if (process.env.OPENCLAW_MODE || process.env.OPENCLAW_URL) {
            try {
                await openClawManager.start(workingDir);
                consoleStyler.log('system', 'OpenClaw integration started');
            } catch (err) {
                consoleStyler.log('warning', `OpenClaw integration failed to start: ${err.message}`);
                // Keep the manager instance so it can be reconfigured later
            }
        }

        // Initialize Task Checkpoint Manager FIRST (so it can be shared with the assistant)
        const taskCheckpointManager = new TaskCheckpointManager({
            eventBus,
            taskManager,
            workingDir,
            aiAssistantClass: MiniAIAssistant
        }, {
            enabled: process.env.OBOTO_CHECKPOINT_ENABLED !== 'false',
            intervalMs: parseInt(process.env.OBOTO_CHECKPOINT_INTERVAL || '10000', 10),
            recoverOnStartup: true,
            notifyOnRecovery: true
        });

        // Initialize checkpoint manager (WAL replay + crash recovery)
        await taskCheckpointManager.initialize();

        // Initialize Scheduler Service
        const schedulerService = new SchedulerService(eventBus, taskManager, workingDir, MiniAIAssistant);
        await schedulerService.restore(); // Restore active schedules

        // Initialize AI assistant (pass checkpoint manager to avoid duplicate creation)
        const assistant = new MiniAIAssistant(workingDir, {
            statusAdapter,
            eventBus,
            taskManager,
            openClawManager,
            workspaceContentServer,
            taskCheckpointManager // Share the single checkpoint manager
        });

        // Wire schedulerService into the assistant
        assistant.schedulerService = schedulerService;
        if (assistant.toolExecutor) {
            assistant.toolExecutor.schedulerService = schedulerService;
        }

        // Initialize Agent Loop Controller
        const agentLoopController = new AgentLoopController({
            schedulerService,
            taskManager,
            assistant,
            eventBus,
            aiAssistantClass: MiniAIAssistant
        });

        // Wire checkpoint manager into assistant's service registry
        assistant._services.register('taskCheckpointManager', taskCheckpointManager);

        // Load custom tools before starting
        await assistant.initializeCustomTools();

        // ── Cloud Sync (optional) ──
        let cloudSync = null;
        const cloudUrl = process.env.OBOTO_CLOUD_URL || secretsManager.get('OBOTO_CLOUD_URL');
        const cloudKey = process.env.OBOTO_CLOUD_KEY || secretsManager.get('OBOTO_CLOUD_KEY');

        if (cloudUrl && cloudKey) {
            try {
                const { CloudSync } = await import('./cloud/cloud-sync.mjs');
                const { loadCloudConfig } = await import('./cloud/cloud-config.mjs');

                const cloudConfig = loadCloudConfig();
                if (cloudConfig) {
                    cloudSync = new CloudSync(eventBus, secretsManager);
                    await cloudSync.initialize(cloudConfig);

                    // Auto-login from cached refresh token (silent, non-blocking)
                    cloudSync.tryAutoLogin().catch(err => {
                        consoleStyler.log('warning', `Cloud auto-login failed: ${err.message}`);
                    });

                    cloudSync.setWorkingDir(workingDir);

                    // Wire cloud reference into AI provider for cloud proxy support
                    const { setCloudSyncRef, setEventBusRef } = await import('./core/ai-provider.mjs');
                    setCloudSyncRef(cloudSync);
                    setEventBusRef(eventBus);

                    // Wire cloud reference into model registry for cloud model fetching
                    const { setCloudSyncForModels } = await import('./core/model-registry.mjs');
                    setCloudSyncForModels(cloudSync);

                    consoleStyler.log('cloud', 'Cloud integration initialized');
                }
            } catch (err) {
                consoleStyler.log('warning', `Cloud integration failed to initialize: ${err.message}`);
            }
        }

        // Wire eventBus into AI provider for WebLLM support (independent of cloud)
        if (!cloudUrl || !cloudKey) {
            try {
                const { setEventBusRef } = await import('./core/ai-provider.mjs');
                setEventBusRef(eventBus);
            } catch { /* ignore */ }
        }

        // Register cloud as optional service (null if not configured)
        assistant._services.register('cloudSync', cloudSync);

        // Resume session if requested
        if (resume) {
            await assistant.loadSession('.ai-session');
        }
        
        if (isServer) {
            // Server mode
            const { startServer } = await import('./server/web-server.mjs');
            // Pass schedulerService, secretsManager, agentLoopController, workspaceContentServer, and cloudSync to startServer
            await startServer(assistant, workingDir, eventBus, 3000, schedulerService, secretsManager, agentLoopController, workspaceContentServer, cloudSync);
        } else if (isInteractive) {
            // Interactive mode
            await cli.startInteractiveMode(assistant, workingDir);
        } else {
            // Single-shot mode
            await cli.runSingleShot(assistant, userInput, workingDir);
        }
        
    } catch (error) {
        cli.displayError(error);
        process.exit(1);
    } finally {
        if (typeof taskCheckpointManager !== 'undefined' && taskCheckpointManager) {
            await taskCheckpointManager.shutdown();
        }
        if (typeof openClawManager !== 'undefined' && openClawManager) {
            await openClawManager.stop();
        }
        if (typeof cloudSync !== 'undefined' && cloudSync) {
            await cloudSync.destroy();
        }
        if (workspaceContentServer) {
            await workspaceContentServer.stop();
        }
        cli.close();
    }
}

// Global error handlers to prevent crashes
let _unhandledRejectionCount = 0;
const _rejectionWindow = 60_000; // 1 minute window
let _rejectionWindowStart = Date.now();

process.on('unhandledRejection', (reason, promise) => {
    consoleStyler.logError('error', 'UNHANDLED REJECTION', reason);
    
    const msg = reason?.message || String(reason);

    // Broadcast to agent loop via event bus if available
    if (_globalEventBus) {
        _globalEventBus.emit('system:error', {
            type: 'unhandledRejection',
            message: msg,
            stack: reason?.stack
        });
    }

    // Track rejection rate — too many in a short window indicates systemic failure
    const now = Date.now();
    if (now - _rejectionWindowStart > _rejectionWindow) {
        _unhandledRejectionCount = 0;
        _rejectionWindowStart = now;
    }
    _unhandledRejectionCount++;

    // Transient/tool errors — keep running
    if (reason?.code === 'ENOENT' || reason?.code === 'ECONNRESET' || msg.includes('scandir') || msg.includes('socket hang up')) {
        return;
    }
    
    // If too many non-transient rejections accumulate, exit to prevent silent corruption
    if (_unhandledRejectionCount > 10) {
        consoleStyler.log('error', 'Too many unhandled rejections in the last minute, exiting.');
        process.exit(1);
    }
});

process.on('uncaughtException', (err) => {
    consoleStyler.logError('error', 'UNCAUGHT EXCEPTION', err);

    const msg = err?.message || '';

    // Broadcast to UI via event bus if available
    if (_globalEventBus) {
        _globalEventBus.emit('system:error', {
            type: 'uncaughtException',
            message: msg,
            stack: err?.stack
        });
    }

    // In server mode, tolerate recoverable native-addon and I/O errors
    // (e.g. node-pty segfaults, EPIPE, ECONNRESET) instead of killing the
    // entire process.  Only truly fatal errors (OOM, stack overflow) should
    // force a shutdown.
    const recoverable = (
        err?.code === 'EPIPE' ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ERR_IPC_CHANNEL_CLOSED' ||
        msg.includes('node-pty') ||
        msg.includes('pty.node') ||
        msg.includes('Napi::Error')
    );

    if (recoverable) {
        consoleStyler.log('warning', 'Recovered from non-fatal uncaught exception — server continues running');
        return;
    }

    // After an uncaught exception, Node.js is in an undefined state.
    // Perform a graceful shutdown.
    setTimeout(() => process.exit(1), 1000);
});

// Handle module execution
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => {
        // Import consoleStyler for error display
        import('./ui/console-styler.mjs').then(({ consoleStyler }) => {
            consoleStyler.logError('error', 'An unexpected error occurred', err);
        }).catch(() => {
            console.error("\x1b[31mAn unexpected error occurred:\x1b[0m", err);
        });
        process.exit(1);
    });
}

export { main };
