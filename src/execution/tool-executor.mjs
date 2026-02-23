// Tool execution logic
// This module contains all the built-in tool schemas used by the AI
// REFACTORED: Tool handlers are now distributed in handlers/*.mjs

import { consoleStyler } from '../ui/console-styler.mjs';
import { emitToolStatus } from '../core/status-reporter.mjs';
import { FileTools } from '../tools/file-tools.mjs';
import { DesktopAutomationTools } from '../tools/desktop-automation-tools.mjs';
import { ManifestManager } from '../structured-dev/manifest-manager.mjs';
import { ImplementationPlanner } from '../structured-dev/implementation-planner.mjs';
import { PlanExecutor } from '../structured-dev/plan-executor.mjs';
import { CodeValidator } from '../quality/code-validator.mjs';
import { C4Visualizer } from '../structured-dev/c4-visualizer.mjs';
import { KnowledgeGraphBuilder } from '../structured-dev/knowledge-graph-builder.mjs';
import { CiCdArchitect } from '../structured-dev/cicd-architect.mjs';
import { ContainerizationWizard } from '../structured-dev/containerization-wizard.mjs';
import { ApiDocSmith } from '../structured-dev/api-doc-smith.mjs';
import { TutorialGenerator } from '../structured-dev/tutorial-generator.mjs';
import { EnhancementGenerator } from '../structured-dev/enhancement-generator.mjs';
import { ShellTools } from '../tools/shell-tools.mjs';
import { BrowserHandlers } from './handlers/browser-handlers.mjs';
import { ChromeExtensionHandlers } from './handlers/chrome-ext-handlers.mjs';
import { SurfaceManager } from '../surfaces/surface-manager.mjs';
import { SkillsManager } from '../skills/skills-manager.mjs';

// Handler Imports
import { FirecrawlHandlers } from './handlers/firecrawl-handlers.mjs';
import { SkillHandlers } from './handlers/skill-handlers.mjs';
import { CoreHandlers } from './handlers/core-handlers.mjs';
import { WorkflowHandlers } from './handlers/workflow-handlers.mjs';
import { StructuredDevHandlers } from './handlers/structured-dev-handlers.mjs';
import { WebHandlers } from './handlers/web-handlers.mjs';
import { AsyncTaskHandlers } from './handlers/async-task-handlers.mjs';
import { OpenClawHandlers } from './handlers/openclaw-handlers.mjs';
import { SurfaceHandlers } from './handlers/surface-handlers.mjs';
import { WorkflowSurfaceHandlers } from './handlers/workflow-surface-handlers.mjs';
import { WorkflowService } from '../services/workflow-service.mjs';
import { dryRunGuard } from './dry-run-guard.mjs';
import { McpHandlers } from './handlers/mcp-handlers.mjs'; // New import
import { registerPersonaHandlers } from './handlers/persona-handlers.mjs';
import { UIStyleHandlers } from './handlers/ui-style-handlers.mjs';
import { MathHandlers } from './handlers/math-handlers.mjs';
import { ImageHandlers } from './handlers/image-handlers.mjs';
import { EmbedHandlers } from './handlers/embed-handlers.mjs';
import { TOOLS, OPENCLAW_TOOLS } from '../tools/tool-definitions.mjs';

const TOOL_TIMEOUTS = {
    read_file: 10_000,
    write_file: 30_000,
    edit_file: 30_000,
    list_files: 15_000,
    read_many_files: 30_000,
    write_many_files: 60_000,
    execute_javascript: 60_000,
    execute_npm_function: 60_000,
    search_web: 30_000,
    browse_open: 60_000,
    browse_act: 30_000,
    browse_screenshot: 15_000,
    browse_close: 5_000,
    call_ai_assistant: 300_000,
    ask_blocking_question: 24 * 60 * 60 * 1000, // 24 hours — effectively indefinite
    spawn_background_task: 10_000, // Fast return
    check_task_status: 5_000,
    execute_implementation_plan: 600_000,
    speak_text: 60_000,
    mouse_move: 5_000,
    mouse_click: 5_000,
    keyboard_type: 10_000,
    keyboard_press: 5_000,
    screen_capture: 15_000,
    delegate_to_openclaw: 120_000,
    openclaw_status: 10_000,
    openclaw_sessions: 10_000,
    default: 60_000
};

export class ToolExecutor {
    constructor(packageManager, customToolsManager, workspaceManager, aiAssistantClass = null, options = {}) {
        this.packageManager = packageManager;
        this.customToolsManager = customToolsManager;
        this.workspaceManager = workspaceManager;
        this.aiAssistantClass = aiAssistantClass;
        this.middleware = options.middleware;
        this.taskManager = options.taskManager;
        this.schedulerService = options.schedulerService;
        this.openClawManager = options.openClawManager;
        this.eventBus = options.eventBus; // New: EventBus
        this.chromeWsBridge = options.chromeWsBridge; // New: Chrome Bridge
        this.dryRun = options.dryRun || false;
        this.historyManager = options.historyManager;
        this.memoryAdapter = options.memoryAdapter; // Add memoryAdapter
        this.mcpClientManager = options.mcpClientManager; // New: MCP Client Manager
        this.personaManager = options.personaManager; // Persona Manager
        this.assistant = options.assistant; // Reference to parent assistant (for persona prompt refresh)
        this.workspaceContentServer = options.workspaceContentServer; // New: Workspace Content Server
        
        this._plannedChanges = [];
        this.recursionLevel = 0;
        
        // Initialize tool managers
        const workspaceRoot = workspaceManager?.workspaceRoot || process.cwd();
        this.fileTools = new FileTools(workspaceRoot);
        this.shellTools = new ShellTools(workspaceRoot);
        this.desktopTools = new DesktopAutomationTools();
        
        // Initialize structured dev components
        this.manifestManager = new ManifestManager(workspaceRoot);
        this.implementationPlanner = new ImplementationPlanner(this.manifestManager);
        this.c4Visualizer = new C4Visualizer(this.manifestManager);
        this.knowledgeGraphBuilder = new KnowledgeGraphBuilder(workspaceRoot);
        this.cicdArchitect = new CiCdArchitect(workspaceRoot);
        this.containerizationWizard = new ContainerizationWizard(workspaceRoot);
        this.apiDocSmith = new ApiDocSmith(workspaceRoot);
        this.tutorialGenerator = new TutorialGenerator(null, workspaceRoot); // History manager injected later if needed
        this.enhancementGenerator = new EnhancementGenerator(workspaceRoot, this.aiAssistantClass);
        this.codeValidator = new CodeValidator(workspaceRoot);
        this.planExecutor = new PlanExecutor(this.manifestManager, this.aiAssistantClass);

        // Initialize Surface Manager
        this.surfaceManager = new SurfaceManager(workspaceRoot);
        
        // Initialize Skills Manager
        this.skillsManager = new SkillsManager(workspaceRoot);

        // Initialize Handlers
        this.coreHandlers = new CoreHandlers(this.packageManager, this.historyManager, this.memoryAdapter, { assistant: this.assistant });
        this.workflowHandlers = new WorkflowHandlers();
        this.structuredDevHandlers = new StructuredDevHandlers(workspaceRoot, this.aiAssistantClass, this.manifestManager);
        this.webHandlers = new WebHandlers();
        this.browserHandlers = new BrowserHandlers();
        this.chromeExtHandlers = this.chromeWsBridge ? new ChromeExtensionHandlers(this.chromeWsBridge) : null;
        this.asyncTaskHandlers = new AsyncTaskHandlers(this.taskManager, this.aiAssistantClass, this.schedulerService, this.eventBus);
        this.openClawHandlers = this.openClawManager ? new OpenClawHandlers(this.openClawManager) : null;
        this.surfaceHandlers = new SurfaceHandlers(this.surfaceManager, this.eventBus);
        this.workflowService = new WorkflowService(this.surfaceManager, this.eventBus);
        this.workflowSurfaceHandlers = new WorkflowSurfaceHandlers(this.workflowService, this.eventBus);
        this.firecrawlHandlers = new FirecrawlHandlers();
        this.skillHandlers = new SkillHandlers(this.skillsManager, this.aiAssistantClass);
        this.mcpHandlers = this.mcpClientManager ? new McpHandlers(this.mcpClientManager) : null;
        this.uiStyleHandlers = new UIStyleHandlers(this.eventBus, workspaceRoot);
        this.mathHandlers = new MathHandlers();
        this.imageHandlers = new ImageHandlers(workspaceRoot, this.workspaceContentServer);
        this.embedHandlers = new EmbedHandlers(this.eventBus);

        // Initialize tool registry
        this.toolRegistry = new Map();
        this.pendingConfirmations = new Map(); // Store pending tool confirmations
        this.allowedPaths = new Set(); // Paths always-allowed by user
        this.registerBuiltInTools();
    }

    // Request confirmation from UI
    requestConfirmation(toolName, args, message, { pathPrefix } = {}) {
        if (!this.eventBus) {
            throw new Error('EventBus not available for confirmation request');
        }

        const confirmationId = `conf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        return new Promise((resolve, reject) => {
            // Set timeout for confirmation (e.g., 5 minutes)
            const timeout = setTimeout(() => {
                this.pendingConfirmations.delete(confirmationId);
                reject(new Error('Confirmation timed out'));
            }, 300000);

            this.pendingConfirmations.set(confirmationId, {
                resolve,
                reject,
                timeout,
                pathPrefix // Store for always-allow resolution
            });

            this.eventBus.emit('tool:confirmation-request', {
                id: confirmationId,
                toolName,
                args,
                message,
                pathPrefix // Send to UI for display
            });
            
            consoleStyler.log('system', `Waiting for user confirmation (ID: ${confirmationId})...`);
        });
    }

    // Resolve a pending confirmation
    resolveConfirmation(id, decision) {
        const pending = this.pendingConfirmations.get(id);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingConfirmations.delete(id);
            
            if (decision === 'approved' || decision === 'always-allow') {
                // If "always-allow", remember the path prefix for future requests
                if (decision === 'always-allow' && pending.pathPrefix) {
                    this.allowedPaths.add(pending.pathPrefix);
                    consoleStyler.log('security', `🔓 Path always-allowed: ${pending.pathPrefix}`);
                }
                pending.resolve(true);
            } else {
                pending.resolve(false);
            }
            return true;
        }
        return false;
    }

    // Check if tool needs path confirmation
    async _validatePathAccess(toolName, args) {
        const fileTools = ['read_file', 'write_file', 'list_files', 'edit_file'];
        if (!fileTools.includes(toolName)) return false;

        const path = await import('path');
        const workspaceRoot = this.workspaceManager?.workspaceRoot || process.cwd();
        
        let targetPath = args.path;
        if (!targetPath) return false;

        const resolvedPath = path.resolve(workspaceRoot, targetPath);
        
        // If path is outside workspace root, check always-allowed paths first
        if (!resolvedPath.startsWith(workspaceRoot)) {
            // Check if this path (or a parent) has been always-allowed
            for (const allowed of this.allowedPaths) {
                if (resolvedPath.startsWith(allowed)) {
                    consoleStyler.log('security', `🔓 Path auto-allowed: ${targetPath}`);
                    args._allowOutside = true;
                    return { needed: false };
                }
            }
            
            // Compute the parent directory for the always-allow feature
            const pathPrefix = path.dirname(resolvedPath);
            
            return {
                needed: true,
                message: `Access to external path '${targetPath}' requires confirmation.`,
                resolvedPath,
                pathPrefix
            };
        }
        
        return { needed: false };
    }

    registerBuiltInTools() {
        // Core Tools
        this.registerTool('execute_npm_function', args => this.coreHandlers.executeNpmFunction(args, this.dryRun, this._plannedChanges));
        this.registerTool('execute_javascript', args => this.coreHandlers.executeJavaScript(args, this.dryRun, this._plannedChanges));
        this.registerTool('read_conversation_history', args => this.coreHandlers.readConversationHistory(args));
        this.registerTool('promote_memory', args => this.coreHandlers.promoteMemory(args));
        this.registerTool('query_global_memory', args => this.coreHandlers.queryGlobalMemory(args));
        this.registerTool('report_to_parent', args => this.coreHandlers.reportToParent(args));

        // Workflow Tools
        this.registerTool('create_todo_list', this.workflowHandlers.createTodoList.bind(this.workflowHandlers));
        this.registerTool('update_todo_status', this.workflowHandlers.updateTodoStatus.bind(this.workflowHandlers));
        this.registerTool('analyze_and_recover', args => this.workflowHandlers.analyzeAndRecover(args, this.packageManager));
        this.registerTool('evaluate_response_quality', this.workflowHandlers.evaluateResponseQuality.bind(this.workflowHandlers));
        this.registerTool('speak_text', this.workflowHandlers.speakText.bind(this.workflowHandlers));

        // Web Tools
        this.registerTool('search_web', this.webHandlers.searchWeb.bind(this.webHandlers));

        // Browser Tools
        this.registerTool('browse_open', this.browserHandlers.browseOpen.bind(this.browserHandlers));
        this.registerTool('browse_act', this.browserHandlers.browseAct.bind(this.browserHandlers));
        this.registerTool('browse_screenshot', this.browserHandlers.browseScreenshot.bind(this.browserHandlers));
        this.registerTool('browse_close', this.browserHandlers.browseClose.bind(this.browserHandlers));

        // Chrome Extension Tools
        if (this.chromeExtHandlers) {
            this.registerChromeTools();
        }

        // Firecrawl Tools
        this.registerTool('firecrawl_scrape', this.firecrawlHandlers.firecrawlScrape.bind(this.firecrawlHandlers));
        this.registerTool('firecrawl_crawl', this.firecrawlHandlers.firecrawlCrawl.bind(this.firecrawlHandlers));
        this.registerTool('firecrawl_check_job', this.firecrawlHandlers.firecrawlCheckJob.bind(this.firecrawlHandlers));

        // Skill Tools
        this.registerTool('list_skills', this.skillHandlers.listSkills.bind(this.skillHandlers));
        this.registerTool('read_skill', this.skillHandlers.readSkill.bind(this.skillHandlers));
        this.registerTool('use_skill', this.skillHandlers.useSkill.bind(this.skillHandlers));

        // Custom Tools
        this.registerTool('list_custom_tools', this.listCustomTools.bind(this));
        this.registerTool('remove_custom_tool', this.removeCustomTool.bind(this));
        this.registerTool('export_tools', this.exportTools.bind(this));

        // Workspace Tools
        this.registerTool('manage_workspace', this.manageWorkspace.bind(this));

        // Structured Dev Tools
        this.registerTool('init_structured_dev', this.structuredDevHandlers.initStructuredDev.bind(this.structuredDevHandlers));
        this.registerTool('bootstrap_project', this.structuredDevHandlers.bootstrapProject.bind(this.structuredDevHandlers));
        this.registerTool('submit_technical_design', this.structuredDevHandlers.submitTechnicalDesign.bind(this.structuredDevHandlers));
        this.registerTool('approve_design', this.structuredDevHandlers.approveDesign.bind(this.structuredDevHandlers));
        this.registerTool('lock_interfaces', this.structuredDevHandlers.lockInterfaces.bind(this.structuredDevHandlers));
        this.registerTool('submit_critique', this.structuredDevHandlers.submitCritique.bind(this.structuredDevHandlers));
        this.registerTool('read_manifest', this.structuredDevHandlers.readManifest.bind(this.structuredDevHandlers));
        this.registerTool('visualize_architecture', this.structuredDevHandlers.visualizeArchitecture.bind(this.structuredDevHandlers));
        this.registerTool('rollback_to_snapshot', this.structuredDevHandlers.rollbackToSnapshot.bind(this.structuredDevHandlers));
        
        this.registerTool('generate_c4_diagram', args => this.structuredDevHandlers.generateC4Diagram(args, this.c4Visualizer));
        this.registerTool('build_knowledge_graph', args => this.structuredDevHandlers.buildKnowledgeGraph(args, this.knowledgeGraphBuilder));
        this.registerTool('generate_cicd_pipeline', args => this.structuredDevHandlers.generateCiCdPipeline(args, this.cicdArchitect));
        this.registerTool('generate_docker_config', args => this.structuredDevHandlers.generateDockerConfig(args, this.containerizationWizard));
        this.registerTool('generate_api_docs', args => this.structuredDevHandlers.generateApiDocs(args, this.apiDocSmith));
        this.registerTool('generate_tutorial', args => this.structuredDevHandlers.generateTutorial(args, this.tutorialGenerator));
        this.registerTool('generate_enhancements', args => this.structuredDevHandlers.generateEnhancements(args, this.enhancementGenerator));
        this.registerTool('implement_enhancements', args => this.structuredDevHandlers.implementEnhancements(args, this.enhancementGenerator));
        
        this.registerTool('create_implementation_plan', args => this.structuredDevHandlers.createImplementationPlan(args, this.implementationPlanner));
        this.registerTool('execute_implementation_plan', args => this.structuredDevHandlers.executeImplementationPlan(args, this.planExecutor));

        // Recursive & Async Tools
        this.registerTool('call_ai_assistant', this.callAiAssistant.bind(this));
        this.registerTool('spawn_background_task', this.asyncTaskHandlers.spawnBackgroundTask.bind(this.asyncTaskHandlers));
        this.registerTool('check_task_status', this.asyncTaskHandlers.checkTaskStatus.bind(this.asyncTaskHandlers));
        this.registerTool('list_background_tasks', this.asyncTaskHandlers.listBackgroundTasks.bind(this.asyncTaskHandlers));
        this.registerTool('cancel_background_task', this.asyncTaskHandlers.cancelBackgroundTask.bind(this.asyncTaskHandlers));
        this.registerTool('get_task_output', this.asyncTaskHandlers.getTaskOutput.bind(this.asyncTaskHandlers));
        this.registerTool('wait_for_task', this.asyncTaskHandlers.waitForTask.bind(this.asyncTaskHandlers));
        
        // Recurring Task Tools
        this.registerTool('create_recurring_task', this.asyncTaskHandlers.createRecurringTask.bind(this.asyncTaskHandlers));
        this.registerTool('list_recurring_tasks', this.asyncTaskHandlers.listRecurringTasks.bind(this.asyncTaskHandlers));
        this.registerTool('manage_recurring_task', this.asyncTaskHandlers.manageRecurringTask.bind(this.asyncTaskHandlers));

        // Blocking Question Tool (Agent Loop)
        this.registerTool('ask_blocking_question', this.asyncTaskHandlers.askBlockingQuestion.bind(this.asyncTaskHandlers));

        // File & Shell Tools
        this.registerTool('read_file', this.fileTools.readFile.bind(this.fileTools));
        this.registerTool('write_file', this.writeFileWithValidation.bind(this));
        this.registerTool('list_files', this.fileTools.listFiles.bind(this.fileTools));
        this.registerTool('edit_file', this.fileTools.editFile.bind(this.fileTools));
        this.registerTool('read_many_files', this.fileTools.readManyFiles.bind(this.fileTools));
        this.registerTool('write_many_files', this.writeManyFilesWithValidation.bind(this));
        this.registerTool('run_command', this.runCommandWithDryRun.bind(this));

        // Desktop Tools
        this.registerTool('mouse_move', this.desktopTools.moveMouse.bind(this.desktopTools));
        this.registerTool('mouse_click', this.desktopTools.clickMouse.bind(this.desktopTools));
        this.registerTool('keyboard_type', this.desktopTools.typeText.bind(this.desktopTools));
        this.registerTool('keyboard_press', this.desktopTools.pressKey.bind(this.desktopTools));
        this.registerTool('screen_capture', this.desktopTools.captureScreen.bind(this.desktopTools));

        // OpenClaw Tools (conditional)
        if (this.openClawHandlers) {
            this.registerTool('delegate_to_openclaw', this.openClawHandlers.delegateToOpenClaw.bind(this.openClawHandlers));
            this.registerTool('openclaw_status', this.openClawHandlers.openclawStatus.bind(this.openClawHandlers));
            this.registerTool('openclaw_sessions', this.openClawHandlers.openclawSessions.bind(this.openClawHandlers));
        }

        // MCP Management Tools
        if (this.mcpHandlers) {
            this.registerTool('mcp_add_server', this.mcpHandlers.addServer.bind(this.mcpHandlers));
            this.registerTool('mcp_remove_server', this.mcpHandlers.removeServer.bind(this.mcpHandlers));
            this.registerTool('mcp_list_servers', this.mcpHandlers.listServers.bind(this.mcpHandlers));
            this.registerTool('mcp_refresh_servers', this.mcpHandlers.refreshServers.bind(this.mcpHandlers));
        }

        // Surface Tools
        this.registerTool('create_surface', this.surfaceHandlers.createSurface.bind(this.surfaceHandlers));
        this.registerTool('update_surface_component', this.surfaceHandlers.updateSurfaceComponent.bind(this.surfaceHandlers));
        this.registerTool('remove_surface_component', this.surfaceHandlers.removeSurfaceComponent.bind(this.surfaceHandlers));
        this.registerTool('list_surfaces', this.surfaceHandlers.listSurfaces.bind(this.surfaceHandlers));
        this.registerTool('delete_surface', this.surfaceHandlers.deleteSurface.bind(this.surfaceHandlers));
        this.registerTool('open_surface', this.surfaceHandlers.openSurface.bind(this.surfaceHandlers));
        this.registerTool('capture_surface', this.surfaceHandlers.captureSurface.bind(this.surfaceHandlers));
        this.registerTool('configure_surface_layout', this.surfaceHandlers.configureSurfaceLayout.bind(this.surfaceHandlers));
        this.registerTool('place_component_in_cell', this.surfaceHandlers.placeComponentInCell.bind(this.surfaceHandlers));

        // Workflow Surface Tools (BubbleLab integration)
        this.registerTool('start_surface_workflow', this.workflowSurfaceHandlers.startSurfaceWorkflow.bind(this.workflowSurfaceHandlers));
        this.registerTool('get_workflow_status', this.workflowSurfaceHandlers.getWorkflowStatus.bind(this.workflowSurfaceHandlers));
        this.registerTool('list_workflows', this.workflowSurfaceHandlers.listWorkflows.bind(this.workflowSurfaceHandlers));
        this.registerTool('cancel_workflow', this.workflowSurfaceHandlers.cancelWorkflow.bind(this.workflowSurfaceHandlers));
        this.registerTool('submit_workflow_interaction', this.workflowSurfaceHandlers.submitWorkflowInteraction.bind(this.workflowSurfaceHandlers));

        // Persona Tools
        if (this.personaManager) {
            registerPersonaHandlers(this.toolRegistry, {
                personaManager: this.personaManager,
                assistant: this.assistant
            });
        }

        // UI Style Tools
        this.registerTool('set_ui_theme', this.uiStyleHandlers.setUITheme.bind(this.uiStyleHandlers));
        this.registerTool('set_ui_tokens', this.uiStyleHandlers.setUITokens.bind(this.uiStyleHandlers));
        this.registerTool('inject_ui_css', this.uiStyleHandlers.injectUICSS.bind(this.uiStyleHandlers));
        this.registerTool('reset_ui_style', this.uiStyleHandlers.resetUIStyle.bind(this.uiStyleHandlers));
        this.registerTool('get_ui_style_state', this.uiStyleHandlers.getUIStyleState.bind(this.uiStyleHandlers));
        this.registerTool('set_display_names', this.uiStyleHandlers.setDisplayNames.bind(this.uiStyleHandlers));

        // Math Tools
        this.registerTool('evaluate_math', this.mathHandlers.evaluateMath.bind(this.mathHandlers));
        this.registerTool('unit_conversion', this.mathHandlers.unitConversion.bind(this.mathHandlers));
        this.registerTool('solve_equation', this.mathHandlers.solveEquation.bind(this.mathHandlers));

        // Image Tools
        this.registerTool('generate_image', this.imageHandlers.generateImage.bind(this.imageHandlers));
        this.registerTool('create_image_variation', this.imageHandlers.createImageVariation.bind(this.imageHandlers));
        this.registerTool('manipulate_image', this.imageHandlers.manipulateImage.bind(this.imageHandlers));
        this.registerTool('get_image_info', this.imageHandlers.getImageInfo.bind(this.imageHandlers));

        // Embed Tools
        this.registerTool('embed_object', this.embedHandlers.embedObject.bind(this.embedHandlers));
    }

    setDryRun(enabled) {
        this.dryRun = enabled;
        if (enabled) {
            consoleStyler.log('system', 'Dry-run mode enabled. Side effects will be simulated.');
        }
    }

    getDryRunResults() {
        return this._plannedChanges;
    }

    getAllToolDefinitions() {
        const allTools = [...TOOLS];

        // Add OpenClaw tools if enabled
        if (this.openClawHandlers && OPENCLAW_TOOLS) {
            allTools.push(...OPENCLAW_TOOLS);
        }

        // Add Custom Tools
        if (this.customToolsManager) {
            const customTools = this.customToolsManager.getCustomToolSchemas();
            allTools.push(...customTools);
        }

        // Add MCP Tools
        if (this.mcpClientManager) {
            const mcpRawTools = this.mcpClientManager.getAllTools();
            const mcpTools = mcpRawTools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema
                }
            }));
            allTools.push(...mcpTools);
        }

        return allTools;
    }

    registerChromeTools() {
        this.registerTool('chrome_list_tabs', this.chromeExtHandlers.listTabs.bind(this.chromeExtHandlers));
        this.registerTool('chrome_create_tab', this.chromeExtHandlers.createTab.bind(this.chromeExtHandlers));
        this.registerTool('chrome_close_tab', this.chromeExtHandlers.closeTab.bind(this.chromeExtHandlers));
        this.registerTool('chrome_navigate', this.chromeExtHandlers.navigate.bind(this.chromeExtHandlers));
        this.registerTool('chrome_list_windows', this.chromeExtHandlers.listWindows.bind(this.chromeExtHandlers));
        this.registerTool('chrome_create_window', this.chromeExtHandlers.createWindow.bind(this.chromeExtHandlers));
        this.registerTool('chrome_close_window', this.chromeExtHandlers.closeWindow.bind(this.chromeExtHandlers));
        this.registerTool('chrome_click', this.chromeExtHandlers.click.bind(this.chromeExtHandlers));
        this.registerTool('chrome_type', this.chromeExtHandlers.type.bind(this.chromeExtHandlers));
        this.registerTool('chrome_evaluate', this.chromeExtHandlers.evaluate.bind(this.chromeExtHandlers));
        this.registerTool('chrome_screenshot', this.chromeExtHandlers.screenshot.bind(this.chromeExtHandlers));
        this.registerTool('chrome_get_page_info', this.chromeExtHandlers.getPageInfo.bind(this.chromeExtHandlers));
        this.registerTool('chrome_query_dom', this.chromeExtHandlers.queryDom.bind(this.chromeExtHandlers));
        this.registerTool('chrome_fill_form', this.chromeExtHandlers.fillForm.bind(this.chromeExtHandlers));
        this.registerTool('chrome_scroll', this.chromeExtHandlers.scroll.bind(this.chromeExtHandlers));
        this.registerTool('chrome_wait_for', this.chromeExtHandlers.waitFor.bind(this.chromeExtHandlers));
        this.registerTool('chrome_cdp_command', this.chromeExtHandlers.cdpCommand.bind(this.chromeExtHandlers));
        this.registerTool('chrome_extract_content', this.chromeExtHandlers.extractContent.bind(this.chromeExtHandlers));
        this.registerTool('chrome_cookies_manage', this.chromeExtHandlers.cookiesManage.bind(this.chromeExtHandlers));
    }

    attachChromeBridge(bridge) {
        this.chromeWsBridge = bridge;
        this.chromeExtHandlers = new ChromeExtensionHandlers(bridge);
        this.registerChromeTools();
    }

    registerTool(name, handler, outputSchema = null) {
        this.toolRegistry.set(name, { handler, outputSchema });
    }

    async executeTool(toolCall, options = {}) {
        const functionName = toolCall.function.name;
        const timeout = TOOL_TIMEOUTS[functionName] || TOOL_TIMEOUTS.default;
        const signal = options.signal;

        if (signal?.aborted) {
             return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: `Error: Execution cancelled`,
            };
        }

        try {
            const racePromises = [
                this._executeToolInner(toolCall, options),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool '${functionName}' timed out after ${timeout / 1000}s`)), timeout)
                )
            ];

            if (signal) {
                racePromises.push(new Promise((_, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('Tool execution cancelled')));
                }));
            }

            const result = await Promise.race(racePromises);
            return result;
        } catch (error) {
            consoleStyler.log('error', `Tool timeout/error: ${error.message}`);
            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: `Error: ${error.message}`,
            };
        }
    }

    async _executeToolInner(toolCall, options = {}) {
        const functionName = toolCall.function.name;
        let toolResultText = '';

        try {
            consoleStyler.log('tools', `🔧 Starting ${functionName}...`);
            const args = JSON.parse(toolCall.function.arguments);

            // Emit human-readable status for the UI
            emitToolStatus(functionName, args);

            // Inject signal into args for tools that support cancellation
            if (options.signal) {
                Object.defineProperty(args, '_signal', {
                    value: options.signal,
                    enumerable: false, // Don't show in logs
                    writable: false
                });
            }
            
            // Sanitize args to prevent LLM from bypassing security
            if (args._allowOutside) delete args._allowOutside;

            // Security Check: Path Access Confirmation
            const securityCheck = await this._validatePathAccess(functionName, args);
            if (securityCheck && securityCheck.needed) {
                consoleStyler.log('security', `🔒 Access outside workspace detected: ${args.path}`);
                try {
                    const confirmed = await this.requestConfirmation(functionName, args, securityCheck.message, {
                        pathPrefix: securityCheck.pathPrefix
                    });
                    if (!confirmed) {
                        return {
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: functionName,
                            content: 'Error: User denied access to path outside workspace.',
                        };
                    }
                    // Add bypass flag
                    args._allowOutside = true;
                    consoleStyler.log('security', '🔓 Access granted by user');
                } catch (err) {
                     return {
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: `Error: Confirmation failed: ${err.message}`,
                    };
                }
            }

            const argsSummary = Object.keys(args).length > 0
                ? Object.keys(args).map(key => `${key}: ${typeof args[key]}`).join(', ')
                : 'no arguments';
            consoleStyler.log('tools', `   Parameters: ${argsSummary}`, { indent: true });

            if (this.toolRegistry.has(functionName)) {
                const toolData = this.toolRegistry.get(functionName);
                const handler = typeof toolData === 'function' ? toolData : toolData.handler;
                toolResultText = await handler(args);
            } else if (this.customToolsManager.hasCustomTool(functionName)) {
                toolResultText = await this.customToolsManager.executeCustomTool(functionName, args);
            } else if (this.mcpClientManager && functionName.startsWith('mcp_')) {
                // Dynamic MCP Tool Dispatch
                // Tool Name Format: mcp_{serverName}_{toolName}
                // We need to find the matching server
                let serverFound = false;
                const servers = this.mcpClientManager.listServers();
                
                for (const server of servers) {
                    const prefix = `mcp_${server.name}_`;
                    if (functionName.startsWith(prefix)) {
                        const originalToolName = functionName.substring(prefix.length);
                        toolResultText = await this.mcpClientManager.executeTool(server.name, originalToolName, args);
                        serverFound = true;
                        break;
                    }
                }
                
                if (!serverFound) {
                    throw new Error(`Unknown tool: ${functionName} (MCP server matching prefix not found)`);
                }
            } else {
                throw new Error(`Unknown tool: ${functionName}`);
            }

            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: toolResultText,
            };

        } catch (error) {
            consoleStyler.log('error', `Tool Error: ${error.message}`);
            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: `Error: ${error.message}`,
            };
        }
    }

    // List custom tools
    async listCustomTools(args) {
        const { category, show_usage = false } = args;
        return await this.customToolsManager.listCustomTools(category, show_usage);
    }

    // Remove custom tool
    async removeCustomTool(args) {
        const { tool_name } = args;
        const result = await this.customToolsManager.removeCustomTool(tool_name);
        return result.message;
    }

    // Export tools
    async exportTools(args) {
        const { output_file, tools: toolsToExport } = args;
        const result = await this.customToolsManager.exportTools(output_file, toolsToExport);
        return result.message;
    }

    // Manage workspace
    async manageWorkspace(args) {
        if (!this.workspaceManager) {
            return "Workspace manager not available";
        }
        return await this.workspaceManager.manageWorkspace(args);
    }

    // Recursive Call
    async callAiAssistant(args) {
        const { query, context, recursion_level = 0 } = args;
        
        const currentLevel = Math.max(this.recursionLevel, recursion_level);
        if (currentLevel >= 3) {
            consoleStyler.log('error', 'Maximum recursion depth reached (3 levels)', { box: true });
            return "Error: Maximum recursion depth (3 levels) reached. Cannot make recursive AI calls.";
        }
        
        if (!this.aiAssistantClass) {
            consoleStyler.log('error', 'AI Assistant class not available for recursive calls');
            return "Error: AI Assistant class not available for recursive calls.";
        }
        
        try {
            consoleStyler.log('ai', `🔄 Initiating recursive AI call (level ${currentLevel + 1})`, { box: true });
            consoleStyler.log('ai', `   Query: ${query.substring(0, 100)}...`, { indent: true });
            consoleStyler.log('ai', `   Context: ${context}`, { indent: true });
            
            const recursiveAssistant = new this.aiAssistantClass(process.cwd());
            await recursiveAssistant.initializeCustomTools();
            
            recursiveAssistant.toolExecutor.recursionLevel = currentLevel + 1;
            
            const contextualQuery = `RECURSIVE CALL (Level ${currentLevel + 1}): ${context}\n\nQuery: ${query}`;
            const response = await recursiveAssistant.run(contextualQuery);
            
            consoleStyler.log('ai', `✅ Recursive AI call completed (level ${currentLevel + 1})`);
            
            return `Recursive AI Assistant Response:\n\nContext: ${context}\nQuery: ${query}\n\nResponse: ${response}`;
            
        } catch (error) {
            consoleStyler.log('error', `Recursive AI call failed: ${error.message}`, { box: true });
            return `Error in recursive AI call: ${error.message}`;
        }
    }

    // Write file wrapper
    async writeFileWithValidation(args) {
        if (this.dryRun) {
            return dryRunGuard(this.dryRun, this._plannedChanges, {
                type: 'write',
                path: args.path,
                contentLength: args.content.length,
                preview: args.content.substring(0, 100) + (args.content.length > 100 ? '...' : '')
            }, () => {});
        }

        const { path, content } = args;
        const writeResult = await this.fileTools.writeFile(args);
        
        if (writeResult.startsWith('Error:')) {
            return writeResult;
        }

        if (this.codeValidator) {
            const validationErrors = await this.codeValidator.validateFile(path);
            if (validationErrors) {
                return `${writeResult}\n\n⚠️ Validation Errors Detected:\n${validationErrors}\n\nPlease review and fix these errors in your next step.`;
            } else {
                 return `${writeResult}\n✓ No validation errors detected.`;
            }
        }

        return writeResult;
    }

    // Write many files wrapper with dry-run support
    async writeManyFilesWithValidation(args) {
        if (this.dryRun) {
            const files = args.files || [];
            for (const file of files) {
                this._plannedChanges.push({
                    type: 'write',
                    path: file.path,
                    contentLength: file.content?.length || 0,
                    preview: (file.content || '').substring(0, 80) + ((file.content || '').length > 80 ? '...' : '')
                });
            }
            return JSON.stringify({ summary: `Dry run: ${files.length} files planned`, results: files.map(f => ({ path: f.path, success: true, message: 'Planned (dry run)', dryRun: true })) });
        }
        return await this.fileTools.writeManyFiles(args);
    }

    // Run command wrapper
    async runCommandWithDryRun(args) {
        if (this.dryRun) {
            return dryRunGuard(this.dryRun, this._plannedChanges, {
                type: 'command',
                command: args.command,
                cwd: args.cwd || this.workspaceManager.workspaceRoot
            }, () => {});
        }
        return await this.shellTools.runCommand(args);
    }

    getCurrentTodos() {
        return this.workflowHandlers.getCurrentTodos();
    }

    getErrorHistory() {
        return this.workflowHandlers.getErrorHistory();
    }
}
