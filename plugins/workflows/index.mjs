/**
 * Oboto Workflows Plugin
 *
 * Provides workflow automation tools: todo lists, error recovery, response
 * quality evaluation, and BubbleLab surface workflows.
 *
 * Extracted from:
 *   - src/execution/handlers/workflow-handlers.mjs
 *   - src/execution/handlers/workflow-surface-handlers.mjs
 *   - src/tools/definitions/workflow-tools.mjs
 *   - src/tools/definitions/workflow-surface-tools.mjs
 *   - src/services/workflow-service.mjs
 *   - src/server/ws-handlers/workflow-handler.mjs
 *
 * NOTE: The speakText tool has been extracted into the TTS plugin and is
 *       intentionally omitted here.
 *
 * @module @oboto/plugin-workflows
 */

import { WorkflowService } from './workflow-service.mjs';

// ── Workflow-handler tool implementations ────────────────────────────────
// These factory functions return handlers that close over the mutable state
// stored on `api._pluginInstance`, avoiding module-level `let` variables that
// would leak across ESM cache-busted reloads.

function makeWorkflowHandlers(instance) {
    return {
        async handleCreateTodoList(args) {
            const { task_description, todos } = args;

            instance.currentTodos = {
                task: task_description,
                items: todos,
                created_at: new Date().toISOString(),
            };

            return `Todo list created with ${todos.length} steps for: ${task_description}`;
        },

        async handleUpdateTodoStatus(args) {
            const { step_index, status, result } = args;

            if (instance.currentTodos && instance.currentTodos.items[step_index]) {
                instance.currentTodos.items[step_index].status = status;
                if (result) {
                    instance.currentTodos.items[step_index].result = result;
                }

                const todo = instance.currentTodos.items[step_index];
                const statusText =
                    status === 'completed' ? 'completed' :
                    status === 'in_progress' ? 'in progress' :
                    'pending';

                return `Step ${step_index + 1} status updated to ${statusText}: ${todo.step}${result ? ` — ${result}` : ''}`;
            }

            return 'Error: Invalid step index or no active todo list';
        },

        async handleAnalyzeAndRecover(args) {
            const { error_message, failed_approach, recovery_strategy, alternative_code } = args;

            instance.errorHistory.push({
                error: error_message,
                approach: failed_approach,
                strategy: recovery_strategy,
                timestamp: new Date().toISOString(),
            });

            switch (recovery_strategy) {
                case 'retry_with_alternative':
                    if (alternative_code) {
                        try {
                            const result = await Promise.resolve(eval(alternative_code));
                            return result === undefined
                                ? 'Recovery successful — code executed'
                                : `Recovery successful: ${JSON.stringify(result)}`;
                        } catch (e) {
                            return `Recovery failed: ${e.message}`;
                        }
                    }
                    return 'No alternative code provided';

                case 'simplify_approach':
                    return 'Breaking down into simpler steps';
                case 'change_method':
                    return 'Switching to different method';
                case 'install_dependencies':
                    return 'Installing missing dependencies';
                case 'fix_syntax':
                    return 'Fixing syntax errors';
                default:
                    return 'Unknown recovery strategy';
            }
        },

        async handleEvaluateResponseQuality(args) {
            const {
                original_query,
                ai_response,
                quality_rating = 0,
                evaluation_reasoning = 'No reasoning',
                remedy_suggestion = '',
            } = args;

            if (quality_rating < 4) {
                return `Quality rating ${quality_rating}/10 — retry needed with remedy: ${remedy_suggestion}`;
            }
            return `Quality rating ${quality_rating}/10 — response approved`;
        },
    };
}

// ── Surface-workflow tool implementations ────────────────────────────────

function makeSurfaceWorkflowHandlers(workflowService) {
    return {
        async startSurfaceWorkflow(args) {
            try {
                const { surface_id, flow_script, trigger_payload } = args;
                if (!workflowService) {
                    return 'WorkflowService not available. BubbleLab integration may not be configured.';
                }
                const result = await workflowService.startWorkflow(flow_script, surface_id, trigger_payload || {});
                return `Workflow started successfully.\nWorkflow ID: ${result.workflowId}\nBound to Surface: ${surface_id}\n\nThe workflow is now executing in the background. Use get_workflow_status to check progress.`;
            } catch (error) {
                return `Error starting workflow: ${error.message}`;
            }
        },

        async getWorkflowStatus(args) {
            try {
                const { workflow_id } = args;
                if (!workflowService) return 'WorkflowService not available.';
                const status = workflowService.getWorkflowStatus(workflow_id);
                if (!status) return `Workflow '${workflow_id}' not found.`;

                const lines = [
                    `Workflow: ${status.workflowId}`,
                    `Surface: ${status.surfaceId}`,
                    `Status: ${status.status}`,
                    `Started: ${status.startedAt}`,
                ];
                if (status.completedAt) lines.push(`Completed: ${status.completedAt}`);
                if (status.error) lines.push(`Error: ${status.error}`);
                if (status.hasPendingInteraction) lines.push('⏳ Waiting for user interaction');
                return lines.join('\n');
            } catch (error) {
                return `Error getting workflow status: ${error.message}`;
            }
        },

        async listWorkflows() {
            try {
                if (!workflowService) return 'WorkflowService not available.';
                const workflows = workflowService.listWorkflows();
                if (workflows.length === 0) return 'No active workflows.';
                return 'Active Workflows:\n' + workflows
                    .map(w => `- ${w.workflowId} [${w.status}] → Surface ${w.surfaceId} (started ${w.startedAt})`)
                    .join('\n');
            } catch (error) {
                return `Error listing workflows: ${error.message}`;
            }
        },

        async cancelWorkflow(args) {
            try {
                const { workflow_id } = args;
                if (!workflowService) return 'WorkflowService not available.';
                await workflowService.cancelWorkflow(workflow_id);
                return `Workflow '${workflow_id}' cancelled successfully.`;
            } catch (error) {
                return `Error cancelling workflow: ${error.message}`;
            }
        },

        async submitWorkflowInteraction(args) {
            try {
                const { workflow_id, interaction_id, data } = args;
                if (!workflowService) return 'WorkflowService not available.';
                await workflowService.submitInteraction(workflow_id, interaction_id, data);
                return `Interaction submitted. Workflow '${workflow_id}' is resuming.`;
            } catch (error) {
                return `Error submitting interaction: ${error.message}`;
            }
        },
    };
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

// NOTE: Plugin state is stored on `api._pluginInstance` rather than in module-level
// variables. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up state via `api._pluginInstance`, and the new module
// starts fresh.

export async function activate(api) {
    // Initialize mutable state on api._pluginInstance
    const instance = { currentTodos: null, errorHistory: [] };
    api._pluginInstance = instance;

    // Build handler closures that capture the local `instance`
    const workflowHandlers = makeWorkflowHandlers(instance);

    // Instantiate WorkflowService
    const surfaceManager = api.services?.surfaceManager ?? null;
    const eventBus = api.events ?? null;
    const workflowService = new WorkflowService({ surfaceManager, eventBus });
    const surfaceHandlers = makeSurfaceWorkflowHandlers(workflowService);

    // Store workflowService on instance for potential cleanup
    instance.workflowService = workflowService;

    // ── Register workflow-handler tools ───────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'create_todo_list',
        description: 'Creates a todo list for complex tasks that need to be broken down into steps. Use this when a user request requires multiple sequential actions.',
        parameters: {
            type: 'object',
            properties: {
                task_description: {
                    type: 'string',
                    description: 'Brief description of the overall task.',
                },
                todos: {
                    type: 'array',
                    description: 'Array of todo items in execution order.',
                    items: {
                        type: 'object',
                        properties: {
                            step: { type: 'string', description: 'Description of this step.' },
                            status: {
                                type: 'string',
                                enum: ['pending', 'in_progress', 'completed'],
                                description: 'Status of this step.',
                            },
                        },
                        required: ['step', 'status'],
                    },
                },
            },
            required: ['task_description', 'todos'],
        },
        handler: (args) => workflowHandlers.handleCreateTodoList(args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'update_todo_status',
        description: 'Updates the status of a todo item and moves to the next step if completed.',
        parameters: {
            type: 'object',
            properties: {
                step_index: { type: 'number', description: 'Zero-based index of the step to update.' },
                status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed'],
                    description: 'New status for this step.',
                },
                result: { type: 'string', description: 'Brief result or outcome of completing this step.' },
            },
            required: ['step_index', 'status'],
        },
        handler: (args) => workflowHandlers.handleUpdateTodoStatus(args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'analyze_and_recover',
        description: 'Analyzes the last error and attempts recovery with alternative approaches.',
        parameters: {
            type: 'object',
            properties: {
                error_message: { type: 'string', description: 'The error message to analyze.' },
                failed_approach: { type: 'string', description: 'Description of what was attempted that failed.' },
                recovery_strategy: {
                    type: 'string',
                    enum: ['retry_with_alternative', 'simplify_approach', 'change_method', 'install_dependencies', 'fix_syntax'],
                    description: 'The recovery strategy to attempt.',
                },
                alternative_code: { type: 'string', description: 'Alternative code to try if using retry_with_alternative strategy.' },
            },
            required: ['error_message', 'failed_approach', 'recovery_strategy'],
        },
        handler: (args) => workflowHandlers.handleAnalyzeAndRecover(args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'evaluate_response_quality',
        description: 'Evaluates the quality of an AI response and suggests improvements.',
        parameters: {
            type: 'object',
            properties: {
                original_query: { type: 'string', description: 'The original user query.' },
                ai_response: { type: 'string', description: 'The AI response to evaluate.' },
                quality_rating: { type: 'number', description: 'Quality rating 1-10.' },
                evaluation_reasoning: { type: 'string', description: 'Reasoning for the quality rating.' },
                remedy_suggestion: { type: 'string', description: 'Suggested remedy if quality is low.' },
            },
            required: ['original_query', 'ai_response', 'quality_rating'],
        },
        handler: (args) => workflowHandlers.handleEvaluateResponseQuality(args),
    });

    // ── Register surface-workflow tools ───────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'start_surface_workflow',
        description: 'Start a BubbleLab automation workflow bound to a surface. The workflow is written as a BubbleFlow class.',
        parameters: {
            type: 'object',
            properties: {
                surface_id: { type: 'string', description: 'The surface ID to bind this workflow to' },
                flow_script: { type: 'string', description: 'Complete BubbleFlow TypeScript source code' },
                trigger_payload: { type: 'object', description: 'Optional initial payload to pass to the flow handle() method' },
            },
            required: ['surface_id', 'flow_script'],
        },
        handler: (args) => surfaceHandlers.startSurfaceWorkflow(args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'get_workflow_status',
        description: 'Get the current status of a running workflow.',
        parameters: {
            type: 'object',
            properties: {
                workflow_id: { type: 'string', description: 'The workflow ID to check' },
            },
            required: ['workflow_id'],
        },
        handler: (args) => surfaceHandlers.getWorkflowStatus(args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'list_workflows',
        description: 'List all active workflows and their bound surfaces.',
        parameters: { type: 'object', properties: {} },
        handler: () => surfaceHandlers.listWorkflows(),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'cancel_workflow',
        description: 'Cancel a running workflow. Any pending user interactions will be rejected.',
        parameters: {
            type: 'object',
            properties: {
                workflow_id: { type: 'string', description: 'The workflow ID to cancel' },
            },
            required: ['workflow_id'],
        },
        handler: (args) => surfaceHandlers.cancelWorkflow(args),
    });

    api.tools.register({
        useOriginalName: true,
        name: 'submit_workflow_interaction',
        description: 'Submit user input data to a workflow that is waiting for interaction.',
        parameters: {
            type: 'object',
            properties: {
                workflow_id: { type: 'string', description: 'The workflow ID' },
                interaction_id: { type: 'string', description: 'The interaction ID from the workflow-interaction-needed event' },
                data: { type: 'object', description: "The user's response data" },
            },
            required: ['workflow_id', 'interaction_id', 'data'],
        },
        handler: (args) => surfaceHandlers.submitWorkflowInteraction(args),
    });

    // ── Register WebSocket handlers ──────────────────────────────────

    api.ws.register('start-workflow', async (data, ctx) => {
        try {
            const { surfaceId, flowScript, flowName } = data.payload || data;
            const result = await workflowService.startWorkflow(flowScript, surfaceId, {});
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:workflow-started`, payload: result }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:error`, payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('submit-interaction', async (data, ctx) => {
        try {
            const { workflowId, interactionId, data: interactionData } = data.payload || data;
            const result = await workflowService.submitInteraction(workflowId, interactionId, interactionData);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:workflow-interaction-submitted`, payload: result }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:error`, payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('cancel-workflow', async (data, ctx) => {
        try {
            const { workflowId } = data.payload || data;
            const result = await workflowService.cancelWorkflow(workflowId);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:workflow-cancelled`, payload: result }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:error`, payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('get-workflow-status', async (data, ctx) => {
        try {
            const { workflowId } = data.payload || data;
            const status = workflowService.getWorkflowStatus(workflowId);
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:workflow-status`, payload: status }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:error`, payload: { error: err.message } }));
            }
        }
    });

    api.ws.register('list-workflows', async (_data, ctx) => {
        try {
            const result = workflowService.listWorkflows();
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:workflow-list`, payload: result }));
            }
        } catch (err) {
            if (ctx && ctx.ws) {
                ctx.ws.send(JSON.stringify({ type: `plugin:workflows:error`, payload: { error: err.message } }));
            }
        }
    });
}

export async function deactivate(api) {
    if (api._pluginInstance) {
        api._pluginInstance.currentTodos = null;
        api._pluginInstance.errorHistory = [];
    }
    api._pluginInstance = null;
}
