// Tool execution logic
// This module contains all the built-in tool schemas used by the AI
// REFACTORED: Tool handlers are now distributed in handlers/*.mjs
// ENHANCED: Output presentation layer (binary guard, overflow, metadata footer)
// TODO: Cache VM sandbox context across tool calls within a single turn
// to avoid repeated context creation overhead. VM sandboxing is currently
// handled in handlers/core-handlers.mjs via vm2.

import { consoleStyler } from '../ui/console-styler.mjs';
import { emitToolStatus } from '../core/status-reporter.mjs';
import { presentToolOutput } from './output-presenter.mjs';
import { CommandRouter } from './command-router.mjs';
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
import { SurfaceManager } from '../surfaces/surface-manager.mjs';
import { SkillsManager } from '../skills/skills-manager.mjs';

// Handler Imports
import { SkillHandlers } from './handlers/skill-handlers.mjs';
import { CoreHandlers } from './handlers/core-handlers.mjs';
import { WorkflowHandlers } from './handlers/workflow-handlers.mjs';
import { StructuredDevHandlers } from './handlers/structured-dev-handlers.mjs';
import { AsyncTaskHandlers } from './handlers/async-task-handlers.mjs';
import { SurfaceHandlers } from './handlers/surface-handlers.mjs';
import { dryRunGuard } from './dry-run-guard.mjs';
import { McpHandlers } from './handlers/mcp-handlers.mjs';
import { TOOLS } from '../tools/tool-definitions.mjs';
import { PluginLoader } from '../plugins/plugin-loader.mjs';
import { copyPluginToWorkspace } from '../plugins/plugin-fork.mjs';
import { sanitizeDirectMarkdown } from '../lib/sanitize-markdown.mjs';

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for fuzzy tool name matching when the AI calls a non-existent tool.
 * Supports an optional `maxDist` parameter for early termination — if the
 * minimum possible distance for the current row exceeds `maxDist`, returns
 * `maxDist + 1` immediately to avoid unnecessary computation.
 */
function _levenshtein(a, b, maxDist = Infinity) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    // Quick check: length difference alone exceeds maxDist
    if (Math.abs(m - n) > maxDist) return maxDist + 1;
    // Use single-row DP for O(min(m,n)) space
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = i; // track minimum value in current row for early exit
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            if (curr[j] < rowMin) rowMin = curr[j];
        }
        // Early termination: if every cell in this row exceeds maxDist,
        // the final distance cannot be ≤ maxDist.
        if (rowMin > maxDist) return maxDist + 1;
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// Tools whose output should NOT be processed by the presentation layer.
// These return structured JSON or very short confirmations that don't benefit
// from binary guards / overflow / metadata footers.
const PRESENTATION_SKIP_TOOLS = new Set([
    // CLI router handles its own presentation layer (binary guard, overflow, footer)
    'run',
    // Shell tools handle their own presentation (stderr, footer, overflow, navigational errors)
    'run_command',
    // Write operations return short confirmations — no need to truncate
    'write_file',
    'write_many_files',
    'edit_file',
    // These return structured JSON that callers parse
    'read_many_files',
    'check_task_status',
    'list_background_tasks',
    'get_task_output',
    'list_recurring_tasks',
    'manage_recurring_task',
    // Surface tools return structured JSON for UI rendering
    'create_surface',
    'update_surface_component',
    'remove_surface_component',
    'list_surfaces',
    'delete_surface',
    'open_surface',
    'capture_surface',
    'configure_surface_layout',
    'place_component_in_cell',
    'read_surface',
    'list_surface_revisions',
    'revert_surface',
    // Recursive AI calls have their own formatting
    'call_ai_assistant',
    'report_to_parent',
    // Blocking questions — not regular tool output
    'ask_blocking_question',
    // Desktop tools return structured data or images
    'screen_capture',
    // Plugin tools return structured JSON
    'list_available_plugins',
]);

const TOOL_TIMEOUTS = {
    read_file: 10_000,
    write_file: 30_000,
    edit_file: 30_000,
    list_files: 15_000,
    read_many_files: 30_000,
    write_many_files: 60_000,
    execute_javascript: 60_000,
    execute_npm_function: 60_000,
    call_ai_assistant: 300_000,
    ask_blocking_question: 24 * 60 * 60 * 1000, // 24 hours — effectively indefinite
    spawn_background_task: 10_000, // Fast return
    check_task_status: 5_000,
    execute_implementation_plan: 600_000,
    generate_math_animation: 180_000, // LLM-generated animation DSL can take a while
    plugin_default: 60_000, // Default timeout for plugin-registered tools
    mouse_move: 5_000,
    mouse_click: 5_000,
    keyboard_type: 10_000,
    keyboard_press: 5_000,
    screen_capture: 15_000,
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
        this.eventBus = options.eventBus;
        this.dryRun = options.dryRun || false;
        this.historyManager = options.historyManager;
        this.memoryAdapter = options.memoryAdapter;
        this.mcpClientManager = options.mcpClientManager;
        this.assistant = options.assistant;
        
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

        // Initialize Command Router (unified CLI)
        this.commandRouter = new CommandRouter({
            fileTools: this.fileTools,
            shellTools: this.shellTools,
            toolExecutor: this,
        });

        // Initialize Surface Manager
        this.surfaceManager = new SurfaceManager(workspaceRoot);
        
        // Initialize Skills Manager
        this.skillsManager = new SkillsManager(workspaceRoot);

        // Initialize Handlers
        this.coreHandlers = new CoreHandlers(this.packageManager, this.historyManager, this.memoryAdapter, { assistant: this.assistant });
        this.workflowHandlers = new WorkflowHandlers(); // kept for getCurrentTodos/getErrorHistory
        this.structuredDevHandlers = new StructuredDevHandlers(workspaceRoot, this.aiAssistantClass, this.manifestManager);
        this.asyncTaskHandlers = new AsyncTaskHandlers(this.taskManager, this.aiAssistantClass, this.schedulerService, this.eventBus);
        this.surfaceHandlers = new SurfaceHandlers(this.surfaceManager, this.eventBus);
        this.skillHandlers = new SkillHandlers(this.skillsManager, this.aiAssistantClass);
        this.mcpHandlers = this.mcpClientManager ? new McpHandlers(this.mcpClientManager) : null;

        // Initialize tool registry
        this.toolRegistry = new Map();
        this.pendingConfirmations = new Map(); // Store pending tool confirmations
        this.allowedPaths = new Set(); // Paths always-allowed by user

        // Plugin tool registrations (managed via registerPluginTool / unregisterPluginTool)
        this._pluginHandlers = new Map();
        this._pluginSchemas = new Map(); // Map<toolName, schema>
        this._pluginSurfaceSafe = new Set();

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

        // Skill Tools
        this.registerTool('list_skills', this.skillHandlers.listSkills.bind(this.skillHandlers));
        this.registerTool('read_skill', this.skillHandlers.readSkill.bind(this.skillHandlers));
        this.registerTool('use_skill', this.skillHandlers.useSkill.bind(this.skillHandlers));
        this.registerTool('add_npm_skill', this.skillHandlers.addNpmSkill.bind(this.skillHandlers));
        this.registerTool('create_skill', this.skillHandlers.createSkill.bind(this.skillHandlers));
        this.registerTool('edit_skill', this.skillHandlers.editSkill.bind(this.skillHandlers));
        this.registerTool('delete_skill', this.skillHandlers.deleteSkill.bind(this.skillHandlers));

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
        this.registerTool('spawn_workspace_task', this.asyncTaskHandlers.spawnWorkspaceTask.bind(this.asyncTaskHandlers));
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

        // Unified CLI Tool (with dry-run guard)
        this.registerTool('run', args => {
            if (this.dryRun) {
                return dryRunGuard(this.dryRun, this._plannedChanges, {
                    type: 'command',
                    command: args.command,
                }, () => {});
            }
            return this.commandRouter.execute(args.command);
        });

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

        // MCP Management Tools
        if (this.mcpHandlers) {
            this.registerTool('mcp_add_server', this.mcpHandlers.addServer.bind(this.mcpHandlers));
            this.registerTool('mcp_remove_server', this.mcpHandlers.removeServer.bind(this.mcpHandlers));
            this.registerTool('mcp_list_servers', this.mcpHandlers.listServers.bind(this.mcpHandlers));
            this.registerTool('mcp_refresh_servers', this.mcpHandlers.refreshServers.bind(this.mcpHandlers));
        }

        // Plugin Tools
        this.registerTool('copy_plugin_to_workspace', this.copyPluginToWorkspace.bind(this));
        this.registerTool('list_available_plugins', this.listAvailablePlugins.bind(this));

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
        this.registerTool('read_surface', this.surfaceHandlers.readSurface.bind(this.surfaceHandlers));
        this.registerTool('list_surface_revisions', this.surfaceHandlers.listSurfaceRevisions.bind(this.surfaceHandlers));
        this.registerTool('revert_surface', this.surfaceHandlers.revertSurface.bind(this.surfaceHandlers));
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
        // Use a Map keyed by tool name to deduplicate.
        // Later entries (custom, MCP, plugin) override earlier ones (core),
        // so plugins using useOriginalName don't cause duplicate declarations.
        const toolMap = new Map();

        for (const tool of TOOLS) {
            const name = tool.function?.name;
            if (name) toolMap.set(name, tool);
        }

        // Dynamically update the `run` tool description with the actual
        // registered command list from CommandRouter. This ensures the LLM
        // sees the real commands available at runtime (including any added
        // after static definition time).
        if (this.commandRouter && toolMap.has('run')) {
            const runTool = toolMap.get('run');
            toolMap.set('run', {
                ...runTool,
                function: {
                    ...runTool.function,
                    description: this.commandRouter.generateToolDescription(),
                },
            });
        }

        // Add Custom Tools
        if (this.customToolsManager) {
            for (const tool of this.customToolsManager.getCustomToolSchemas()) {
                const name = tool.function?.name;
                if (name) toolMap.set(name, tool);
            }
        }

        // Add MCP Tools
        if (this.mcpClientManager) {
            for (const t of this.mcpClientManager.getAllTools()) {
                const tool = {
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema
                    }
                };
                toolMap.set(t.name, tool);
            }
        }

        // Add Plugin Tools (last — highest priority override)
        if (this._pluginSchemas.size > 0) {
            for (const tool of this._pluginSchemas.values()) {
                const name = tool.function?.name;
                if (name) toolMap.set(name, tool);
            }
        }

        return [...toolMap.values()];
    }

    registerTool(name, handler, outputSchema = null) {
        this.toolRegistry.set(name, { handler, outputSchema });
    }

    /**
     * Register a tool provided by a plugin.
     *
     * @param {string} name — fully qualified tool name
     * @param {Function} handler — async (args) => string
     * @param {object} schema — OpenAI-style tool schema ({type:'function', function:{…}})
     * @param {{ surfaceSafe?: boolean }} [options]
     */
    registerPluginTool(name, handler, schema, options = {}) {
        if (this.toolRegistry.has(name)) {
            consoleStyler.log('warning', `Plugin tool "${name}" conflicts with a core tool — the core handler and schema take priority. The plugin handler is stored as fallback.`);
            // Store handler for fallback but do NOT override the core schema
            this._pluginHandlers.set(name, handler);
            // Don't add to _pluginSchemas — core schema takes priority
            if (options.surfaceSafe) {
                this._pluginSurfaceSafe.add(name);
            }
            return;
        }
        if (this._pluginHandlers.has(name)) {
            consoleStyler.log('warning', `Plugin tool name collision: "${name}" — overwriting`);
        }
        this._pluginHandlers.set(name, handler);
        this._pluginSchemas.set(name, schema);
        if (options.surfaceSafe) {
            this._pluginSurfaceSafe.add(name);
        }
    }

    /**
     * Unregister a plugin-provided tool.
     *
     * @param {string} name — fully qualified tool name
     */
    unregisterPluginTool(name) {
        this._pluginHandlers.delete(name);
        this._pluginSurfaceSafe.delete(name);
        this._pluginSchemas.delete(name);
    }

    /**
     * Check if a plugin tool is marked as surface-safe.
     * @param {string} name — tool name
     * @returns {boolean}
     */
    isPluginSurfaceSafe(name) {
        return this._pluginSurfaceSafe.has(name);
    }

    /**
     * Get the raw handler function for a registered tool by name.
     * Checks core registry first, then plugin handlers, then custom tools.
     * Returns null if the tool is not found.
     * @param {string} name — tool name
     * @returns {Function|null}
     */
    getToolFunction(name) {
        // 1. Core tool registry
        const entry = this.toolRegistry.get(name);
        if (entry) return typeof entry === 'function' ? entry : entry.handler;

        // 2. Plugin-registered tools
        if (this._pluginHandlers.has(name)) {
            return this._pluginHandlers.get(name);
        }

        // 3. Custom tools
        if (this.customToolsManager?.hasCustomTool(name)) {
            return (args) => this.customToolsManager.executeCustomTool(name, args);
        }

        return null;
    }

    /**
     * Find tool names similar to the given unknown name using Levenshtein distance.
     * Returns up to 5 matches with distance ≤ max(4, name.length * 0.4).
     * Searches core registry, plugin handlers, custom tools, and MCP tools.
     * @param {string} name — the unknown tool name
     * @returns {string[]} — list of similar tool names, sorted by distance
     */
    _findSimilarTools(name) {
        const candidates = new Set();

        // Core tools
        for (const key of this.toolRegistry.keys()) candidates.add(key);

        // Plugin tools
        for (const key of this._pluginHandlers.keys()) candidates.add(key);

        // Custom tools
        if (this.customToolsManager) {
            try {
                const schemas = this.customToolsManager.getCustomToolSchemas();
                for (const s of schemas) {
                    const n = s.function?.name;
                    if (n) candidates.add(n);
                }
            } catch { /* ignore */ }
        }

        // MCP tools
        if (this.mcpClientManager) {
            try {
                for (const t of this.mcpClientManager.getAllTools()) {
                    if (t.name) candidates.add(t.name);
                }
            } catch { /* ignore */ }
        }

        const maxDist = Math.max(4, Math.floor(name.length * 0.4));
        const scored = [];
        const nameLower = name.toLowerCase();
        // Extract word tokens from the unknown name for substring matching
        const nameTokens = nameLower.split(/[_\-\s]+/).filter(t => t.length > 2);

        for (const candidate of candidates) {
            const dist = _levenshtein(name, candidate, maxDist);
            if (dist <= maxDist && dist > 0) {
                scored.push({ name: candidate, dist });
            } else if (dist > maxDist && nameTokens.length > 0) {
                // Fallback: check if all significant tokens appear in the candidate
                const candidateLower = candidate.toLowerCase();
                const matchCount = nameTokens.filter(t => candidateLower.includes(t)).length;
                if (matchCount >= Math.ceil(nameTokens.length * 0.6)) {
                    // Score higher distance so Levenshtein matches rank first
                    scored.push({ name: candidate, dist: maxDist + 1 });
                }
            }
        }
        scored.sort((a, b) => a.dist - b.dist);
        return scored.slice(0, 5).map(s => s.name);
    }

    async executeTool(toolCall, options = {}) {
        const functionName = toolCall.function.name;
        // Use plugin_default timeout for plugin-registered tools, else per-tool or global default
        const timeout = TOOL_TIMEOUTS[functionName]
            || (this._pluginHandlers.has(functionName) ? TOOL_TIMEOUTS.plugin_default : TOOL_TIMEOUTS.default);
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
        const startTime = Date.now(); // ← Timing for presentation layer

        try {
            consoleStyler.log('tools', `🔧 Starting ${functionName}...`);
            const args = JSON.parse(toolCall.function.arguments);

            // Emit human-readable status for the UI
            emitToolStatus(functionName, args);

            // Emit structured tool-call event so the UI can show ToolCall components
            // (including BrowserPreview for browser plugin results).
            // Uses 'server:tool-call-start/end' to distinguish from the high-level
            // 'server:tool-start/end' emitted by ServerStatusAdapter for facade
            // operations (ai_man_chat, ai_man_execute, etc.).
            if (this.eventBus) {
                this.eventBus.emitTyped('server:tool-call-start', { toolName: functionName, args });
            }

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
                consoleStyler.log('security', `Access outside workspace detected: ${args.path}`);
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
            } else if (this._pluginHandlers.has(functionName)) {
                // Plugin-registered tool dispatch — wrapped in try-catch since plugin
                // code is untrusted and more likely to throw unexpected errors.
                const pluginHandler = this._pluginHandlers.get(functionName);
                try {
                    toolResultText = await pluginHandler(args);
                    // Handle __directMarkdown: plugins can return { __directMarkdown: "..." }
                    // to inject markdown (e.g. code fences for tradingchart, mathanim) directly
                    // into the assistant's response instead of being shown as a tool result.
                    if (toolResultText && typeof toolResultText === 'object' && toolResultText.__directMarkdown) {
                        toolResultText = sanitizeDirectMarkdown(toolResultText.__directMarkdown);
                    }
                } catch (pluginErr) {
                    consoleStyler.log('error', `Plugin tool error (${functionName}): ${pluginErr.message}`);
                    toolResultText = `Plugin tool error (${functionName}): ${pluginErr.message}`;
                }
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
                    const similar = this._findSimilarTools(functionName);
                    const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
                    throw new Error(`[error] unknown tool: ${functionName}. MCP server matching prefix not found.${hint} Use mcp_list_servers to see available servers.`);
                }
            } else {
                const similar = this._findSimilarTools(functionName);
                const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
                throw new Error(`[error] unknown tool: ${functionName}.${hint} Use list_custom_tools or list_skills to find available tools.`);
            }

            const durationMs = Date.now() - startTime;

            // ── Presentation Layer (Layer 2) ──
            // Process raw tool output through binary guard, overflow truncation,
            // and metadata footer before returning to the LLM.
            const skipPresentation = PRESENTATION_SKIP_TOOLS.has(functionName);
            if (!skipPresentation && typeof toolResultText === 'string') {
                toolResultText = presentToolOutput(toolResultText, {
                    toolName: functionName,
                    durationMs,
                    filePath: args.path || args.file || undefined,
                });
            }

            // Emit structured tool-call-end event so the UI can update ToolCall
            // components with the result (browser previews, file contents, etc.)
            if (this.eventBus) {
                this.eventBus.emitTyped('server:tool-call-end', { toolName: functionName, result: toolResultText });
            }

            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: toolResultText,
            };

        } catch (error) {
            const durationMs = Date.now() - startTime;
            consoleStyler.log('error', `Tool Error: ${error.message}`);

            // Format error with presentation layer metadata
            const errorContent = `${error.message}\n[exit:1 | ${durationMs}ms]`;

            // Emit tool-call-end with error so the UI can show the failure
            if (this.eventBus) {
                this.eventBus.emitTyped('server:tool-call-end', { toolName: functionName, result: errorContent });
            }
            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: errorContent,
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
        if (args.content === undefined || args.content === null) {
            return `Error: No content provided for write_file (path: ${args.path || '(none)'}). ` +
                `This usually happens when the content was too large and got truncated during generation. ` +
                `To fix this, try one of these approaches:\n` +
                `1. Write the file in smaller sections using multiple write_file calls with append mode\n` +
                `2. Use edit_file to build the file incrementally\n` +
                `3. Write a shorter version of the content first, then expand it\n` +
                `4. Split the content into multiple smaller files\n` +
                `You MUST retry writing this file - do not give up or just describe what you would write.`;
        }

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
        
        if (writeResult.startsWith('[error]') || writeResult.startsWith('Error:')) {
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

    // Copy plugin to workspace .plugins/ directory
    async copyPluginToWorkspace(args) {
        const { plugin_name, force = false } = args;
        const workspaceRoot = this.workspaceManager?.workspaceRoot || process.cwd();
        const loader = new PluginLoader(workspaceRoot);
        const result = await copyPluginToWorkspace(loader, plugin_name, { force });
        return result.message;
    }

    // List all discoverable plugins
    async listAvailablePlugins(args) {
        const workspaceRoot = this.workspaceManager?.workspaceRoot || process.cwd();
        const loader = new PluginLoader(workspaceRoot);
        const discovered = await loader.discover();
        const list = discovered.map(p => ({
            name: p.name,
            source: p.source,
            version: p.manifest.version || '0.0.0',
            description: p.manifest.description || '',
            dir: p.dir
        }));
        return JSON.stringify(list, null, 2);
    }

    getCurrentTodos() {
        return this.workflowHandlers.getCurrentTodos();
    }

    getErrorHistory() {
        return this.workflowHandlers.getErrorHistory();
    }
}
