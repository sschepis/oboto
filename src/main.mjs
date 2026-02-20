// Main entry point for the AI Assistant
// Orchestrates CLI interface and AI assistant initialization

import { AssistantFacade as MiniAIAssistant } from './core/assistant-facade.mjs';
import { CLIInterface } from './cli/cli-interface.mjs';
import { AiManEventBus } from './lib/event-bus.mjs';
import { consoleStyler } from './ui/console-styler.mjs';
import { TaskManager } from './core/task-manager.mjs';
import { SchedulerService } from './core/scheduler-service.mjs';
import { AgentLoopController } from './core/agent-loop-controller.mjs';
import { OpenClawManager } from './integration/openclaw/manager.mjs';
import { SecretsManager } from './server/secrets-manager.mjs';
import { WorkspaceContentServer } from './server/workspace-content-server.mjs';

// Main execution function
async function main() {
    const cli = new CLIInterface();
    const eventBus = new AiManEventBus();
    const workspaceContentServer = new WorkspaceContentServer();
    let openClawManager = null; // Lift scope
    
    try {
        // Set up signal handlers for graceful shutdown
        cli.setupSignalHandlers();
        
        // Parse command line arguments
        const { args, workingDir, isInteractive, userInput, resume, isServer } = cli.parseArguments();
        
        // Load secrets early so vault values override .env before config is consumed
        const secretsManager = new SecretsManager(workingDir);
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
                console.log('[Main] OpenClaw integration started');
            } catch (err) {
                console.warn(`[Main] OpenClaw integration failed to start: ${err.message}`);
                // Keep the manager instance so it can be reconfigured later
            }
        }

        // Initialize AI assistant
        const assistant = new MiniAIAssistant(workingDir, {
            statusAdapter,
            eventBus,
            taskManager,
            openClawManager,
            workspaceContentServer // Pass content server
        });
        
        // Initialize Scheduler Service
        const schedulerService = new SchedulerService(eventBus, taskManager, workingDir, MiniAIAssistant);
        await schedulerService.restore(); // Restore active schedules

        // Wire schedulerService into the assistant (created after assistant due to dependency order)
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

                    consoleStyler.log('system', '☁️  Cloud integration initialized');
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

// Handle module execution
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => {
        // Import consoleStyler for error display
        import('./ui/console-styler.mjs').then(({ consoleStyler }) => {
            consoleStyler.log('error', `An unexpected error occurred: ${err.message}`);
        }).catch(() => {
            console.error("\x1b[31mAn unexpected error occurred:\x1b[0m", err);
        });
        process.exit(1);
    });
}

export { main };
