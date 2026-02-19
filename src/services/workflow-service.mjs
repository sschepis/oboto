import { v4 as uuidv4 } from 'uuid';

/**
 * WorkflowService manages the lifecycle of BubbleLab workflow executions
 * bound to Oboto Surfaces.
 *
 * Responsibilities:
 * - Starting workflows from AI agent tool calls
 * - Tracking active workflows and their state
 * - Pausing/resuming workflows when SurfaceBubble needs user input
 * - Forwarding workflow events to the UI via EventBus
 * - Cleaning up completed/failed workflows
 */
export class WorkflowService {
    constructor(surfaceManager, eventBus, config = {}) {
        this.surfaceManager = surfaceManager;
        this.eventBus = eventBus;
        this.config = config;

        /** @type {Map<string, WorkflowState>} */
        this.activeWorkflows = new Map();

        /** @type {Map<string, { resolve: Function, reject: Function, timeout: NodeJS.Timeout }>} */
        this.pendingInteractions = new Map();

        // BubbleLab imports — lazy-loaded to avoid top-level ESM issues
        this._bubbleFactory = null;
        this._BubbleRunner = null;
        this._BubbleFactory = null;
    }

    /**
     * Lazy-load BubbleLab dependencies
     */
    async _ensureBubbleLabLoaded() {
        if (this._BubbleRunner) return;
        const core = await import('@bubblelab/bubble-core');
        const runtime = await import('@bubblelab/bubble-runtime');
        this._BubbleFactory = core.BubbleFactory;
        this._BubbleRunner = runtime.BubbleRunner;
        this._BubbleLogger = core.BubbleLogger;
        this._LogLevel = core.LogLevel;
        this._bubbleFactory = new this._BubbleFactory();
    }

    /**
     * Start a BubbleLab workflow bound to a surface.
     *
     * @param {string} flowScript - TypeScript/JS BubbleFlow source code
     * @param {string} surfaceId - The surface ID this workflow is bound to
     * @param {object} triggerPayload - Initial payload passed to flow.handle()
     * @returns {{ workflowId: string }} 
     */
    async startWorkflow(flowScript, surfaceId, triggerPayload = {}) {
        await this._ensureBubbleLabLoaded();

        const workflowId = uuidv4();
        const surface = await this.surfaceManager.getSurface(surfaceId);
        if (!surface) {
            throw new Error(`Surface ${surfaceId} not found`);
        }

        const state = {
            workflowId,
            surfaceId,
            status: 'running',
            startedAt: new Date().toISOString(),
            steps: [],
            result: null,
            error: null,
        };

        this.activeWorkflows.set(workflowId, state);

        // Emit workflow started event
        if (this.eventBus) {
            this.eventBus.emit('workflow:started', { workflowId, surfaceId });
        }

        // Execute the workflow asynchronously
        this._executeWorkflow(workflowId, flowScript, triggerPayload).catch(err => {
            console.error(`[WorkflowService] Workflow ${workflowId} execution error:`, err);
        });

        return { workflowId };
    }

    /**
     * Internal: Execute the workflow script using BubbleRunner
     */
    async _executeWorkflow(workflowId, flowScript, triggerPayload) {
        const state = this.activeWorkflows.get(workflowId);
        if (!state) return;

        try {
            // Inject the surface interaction bridge into the flow script
            const augmentedScript = this._injectSurfaceBridge(flowScript, workflowId, state.surfaceId);

            const runner = new this._BubbleRunner(
                augmentedScript,
                this._bubbleFactory,
                {
                    enableLogging: true,
                    logLevel: this._LogLevel.INFO,
                    pricingTable: {},
                    streamCallback: (event) => {
                        // Forward log events to UI
                        if (this.eventBus) {
                            this.eventBus.emit('workflow:log', {
                                workflowId,
                                event,
                            });
                        }
                    },
                }
            );

            const result = await runner.runAll(triggerPayload);

            state.status = result.success ? 'completed' : 'failed';
            state.result = result.data;
            state.error = result.error || null;
            state.completedAt = new Date().toISOString();

            if (this.eventBus) {
                this.eventBus.emit(result.success ? 'workflow:completed' : 'workflow:error', {
                    workflowId,
                    surfaceId: state.surfaceId,
                    result: result.data,
                    error: result.error,
                    summary: result.summary,
                });
            }

            runner.dispose();
        } catch (error) {
            state.status = 'failed';
            state.error = error.message;
            state.completedAt = new Date().toISOString();

            if (this.eventBus) {
                this.eventBus.emit('workflow:error', {
                    workflowId,
                    surfaceId: state.surfaceId,
                    error: error.message,
                });
            }
        }
    }

    /**
     * Inject surface interaction bridge code into the flow script.
     * This adds a global `__surfaceBridge__` object the flow can use
     * to update surfaces and wait for user input.
     */
    _injectSurfaceBridge(flowScript, workflowId, surfaceId) {
        // The bridge is injected as a global that the generated flow code can use.
        // In practice, the AI agent generates flows that call HttpBubble 
        // to POST to our API, or we inject a custom mechanism.
        // For now, we keep this simple — the bridge is available via context.
        return flowScript;
    }

    /**
     * Submit user interaction data to a paused workflow.
     *
     * @param {string} workflowId
     * @param {string} interactionId
     * @param {any} data - User response data
     */
    async submitInteraction(workflowId, interactionId, data) {
        const pending = this.pendingInteractions.get(interactionId);
        if (!pending) {
            throw new Error(`No pending interaction ${interactionId} found`);
        }

        clearTimeout(pending.timeout);
        pending.resolve(data);
        this.pendingInteractions.delete(interactionId);

        if (this.eventBus) {
            this.eventBus.emit('workflow:interaction-submitted', {
                workflowId,
                interactionId,
            });
        }

        return { success: true };
    }

    /**
     * Create a pending interaction that pauses until user responds.
     * Called internally by SurfaceBubble or injected bridge code.
     *
     * @param {string} workflowId
     * @param {string} surfaceId
     * @param {string} componentName
     * @param {number} timeoutMs
     * @returns {Promise<any>} Resolves with user data
     */
    createInteraction(workflowId, surfaceId, componentName, timeoutMs = 300000) {
        const interactionId = uuidv4();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingInteractions.delete(interactionId);
                reject(new Error(`Interaction ${interactionId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingInteractions.set(interactionId, { resolve, reject, timeout });

            if (this.eventBus) {
                this.eventBus.emit('workflow:interaction-needed', {
                    workflowId,
                    interactionId,
                    surfaceId,
                    componentName,
                });
            }
        });
    }

    /**
     * Cancel a running workflow.
     */
    async cancelWorkflow(workflowId) {
        const state = this.activeWorkflows.get(workflowId);
        if (!state) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        state.status = 'cancelled';
        state.completedAt = new Date().toISOString();

        // Reject any pending interactions
        for (const [id, pending] of this.pendingInteractions.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Workflow cancelled'));
            this.pendingInteractions.delete(id);
        }

        if (this.eventBus) {
            this.eventBus.emit('workflow:cancelled', {
                workflowId,
                surfaceId: state.surfaceId,
            });
        }

        return { success: true };
    }

    /**
     * Get the current status of a workflow.
     */
    getWorkflowStatus(workflowId) {
        const state = this.activeWorkflows.get(workflowId);
        if (!state) return null;

        return {
            workflowId: state.workflowId,
            surfaceId: state.surfaceId,
            status: state.status,
            startedAt: state.startedAt,
            completedAt: state.completedAt || null,
            error: state.error,
            hasPendingInteraction: [...this.pendingInteractions.keys()].length > 0,
        };
    }

    /**
     * List all active workflows.
     */
    listWorkflows() {
        const workflows = [];
        for (const state of this.activeWorkflows.values()) {
            workflows.push({
                workflowId: state.workflowId,
                surfaceId: state.surfaceId,
                status: state.status,
                startedAt: state.startedAt,
            });
        }
        return workflows;
    }

    /**
     * Clean up completed/failed workflows older than maxAge.
     */
    cleanup(maxAgeMs = 3600000) {
        const now = Date.now();
        for (const [id, state] of this.activeWorkflows.entries()) {
            if (state.completedAt) {
                const completedAt = new Date(state.completedAt).getTime();
                if (now - completedAt > maxAgeMs) {
                    this.activeWorkflows.delete(id);
                }
            }
        }
    }
}
