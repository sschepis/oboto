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
            console.warn(`[ToolExecutor] Plugin tool "${name}" conflicts with a core tool — the core handler and schema take priority. The plugin handler is stored as fallback.`);
            // Store handler for fallback but do NOT override the core schema
            this._pluginHandlers.set(name, handler);
            // Don't add to _pluginSchemas — core schema takes priority
            if (options.surfaceSafe) {
                this._pluginSurfaceSafe.add(name);
            }
            return;
        }
        if (this._pluginHandlers.has(name)) {
            console.warn(`[ToolExecutor] Plugin tool name collision: "${name}" — overwriting`);
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
     * Returns null if the tool is not found.
     * @param {string} name — tool name
     * @returns {Function|null}
     */
    getToolFunction(name) {
        const entry = this.toolRegistry.get(name);
        if (!entry) return null;
        return typeof entry === 'function' ? entry : entry.handler;
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
            } else if (this._pluginHandlers.has(functionName)) {
                // Plugin-registered tool dispatch — wrapped in try-catch since plugin
                // code is untrusted and more likely to throw unexpected errors.
                const pluginHandler = this._pluginHandlers.get(functionName);
                try {
                    toolResultText = await pluginHandler(args);
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
