/**
 * WorkflowService — manages BubbleLab workflow lifecycle bound to Oboto Surfaces.
 *
 * Ported from src/services/workflow-service.mjs.
 * Uses the plugin eventBus (api.events) to broadcast workflow state changes.
 *
 * @module @oboto/plugin-workflows/workflow-service
 */

import { randomUUID } from 'crypto';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

export class WorkflowService {
    /**
     * @param {object} opts
     * @param {object} [opts.surfaceManager] — surface manager (from api.services)
     * @param {object} [opts.eventBus]       — event emitter (api.events or plugin-local)
     * @param {object} [opts.config]         — optional config overrides
     */
    constructor({ surfaceManager = null, eventBus = null, config = {} } = {}) {
        this.surfaceManager = surfaceManager;
        this.eventBus = eventBus;
        this.config = config;

        /** @type {Map<string, object>} */
        this.activeWorkflows = new Map();

        /** @type {Map<string, { resolve: Function, reject: Function, timeout: NodeJS.Timeout }>} */
        this.pendingInteractions = new Map();

        // BubbleLab imports — lazy-loaded
        this._bubbleFactory = null;
        this._BubbleRunner = null;
        this._BubbleFactory = null;
    }

    /* ------------------------------------------------------------------ */
    /*  Lazy-load BubbleLab dependencies                                  */
    /* ------------------------------------------------------------------ */

    async _ensureBubbleLabLoaded() {
        if (this._BubbleRunner) return;
        try {
            const core = await import('@bubblelab/bubble-core');
            const runtime = await import('@bubblelab/bubble-runtime');
            this._BubbleFactory = core.BubbleFactory;
            this._BubbleRunner = runtime.BubbleRunner;
            this._BubbleLogger = core.BubbleLogger;
            this._LogLevel = core.LogLevel;
            this._bubbleFactory = new this._BubbleFactory();
        } catch {
            // BubbleLab not installed — workflows will fail at startWorkflow()
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Start a workflow                                                   */
    /* ------------------------------------------------------------------ */

    /**
     * Start a BubbleLab workflow bound to a surface.
     *
     * @param {string} flowScript      — TypeScript/JS BubbleFlow source code
     * @param {string} surfaceId       — the surface ID this workflow is bound to
     * @param {object} triggerPayload  — initial payload passed to flow.handle()
     * @returns {{ workflowId: string }}
     */
    async startWorkflow(flowScript, surfaceId, triggerPayload = {}) {
        await this._ensureBubbleLabLoaded();

        if (!this._BubbleRunner) {
            throw new Error('BubbleLab runtime not available. Install @bubblelab/bubble-core and @bubblelab/bubble-runtime.');
        }

        const workflowId = randomUUID();

        if (this.surfaceManager) {
            const surface = await this.surfaceManager.getSurface(surfaceId);
            if (!surface) {
                throw new Error(`Surface ${surfaceId} not found`);
            }
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

        this._emit('workflow:started', { workflowId, surfaceId });

        // Execute asynchronously
        this._executeWorkflow(workflowId, flowScript, triggerPayload).catch(err => {
            consoleStyler.logError('error', `Workflow ${workflowId} execution error`, err);
        });

        return { workflowId };
    }

    /* ------------------------------------------------------------------ */
    /*  Internal: execute the workflow script via BubbleRunner              */
    /* ------------------------------------------------------------------ */

    async _executeWorkflow(workflowId, flowScript, triggerPayload) {
        const state = this.activeWorkflows.get(workflowId);
        if (!state) return;

        try {
            const augmentedScript = this._injectSurfaceBridge(flowScript, workflowId, state.surfaceId);

            const runner = new this._BubbleRunner(
                augmentedScript,
                this._bubbleFactory,
                {
                    enableLogging: true,
                    logLevel: this._LogLevel.INFO,
                    pricingTable: {},
                    streamCallback: (event) => {
                        this._emit('workflow:log', { workflowId, event });
                    },
                }
            );

            const result = await runner.runAll(triggerPayload);

            state.status = result.success ? 'completed' : 'failed';
            state.result = result.data;
            state.error = result.error || null;
            state.completedAt = new Date().toISOString();

            this._emit(result.success ? 'workflow:completed' : 'workflow:error', {
                workflowId,
                surfaceId: state.surfaceId,
                result: result.data,
                error: result.error,
                summary: result.summary,
            });

            runner.dispose();
        } catch (error) {
            state.status = 'failed';
            state.error = error.message;
            state.completedAt = new Date().toISOString();

            this._emit('workflow:error', {
                workflowId,
                surfaceId: state.surfaceId,
                error: error.message,
            });
        }
    }

    /**
     * Inject surface interaction bridge code into the flow script.
     */
    _injectSurfaceBridge(flowScript, _workflowId, _surfaceId) {
        // Placeholder — the bridge is available via context in future iterations
        return flowScript;
    }

    /* ------------------------------------------------------------------ */
    /*  Interactions                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Submit user interaction data to a paused workflow.
     */
    async submitInteraction(workflowId, interactionId, data) {
        const pending = this.pendingInteractions.get(interactionId);
        if (!pending) {
            throw new Error(`No pending interaction ${interactionId} found`);
        }

        clearTimeout(pending.timeout);
        pending.resolve(data);
        this.pendingInteractions.delete(interactionId);

        this._emit('workflow:interaction-submitted', { workflowId, interactionId });

        return { success: true };
    }

    /**
     * Create a pending interaction that pauses until user responds.
     */
    createInteraction(workflowId, surfaceId, componentName, timeoutMs = 300000) {
        const interactionId = randomUUID();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingInteractions.delete(interactionId);
                reject(new Error(`Interaction ${interactionId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingInteractions.set(interactionId, { resolve, reject, timeout });

            this._emit('workflow:interaction-needed', {
                workflowId,
                interactionId,
                surfaceId,
                componentName,
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Cancel / status / list / cleanup                                   */
    /* ------------------------------------------------------------------ */

    async cancelWorkflow(workflowId) {
        const state = this.activeWorkflows.get(workflowId);
        if (!state) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        state.status = 'cancelled';
        state.completedAt = new Date().toISOString();

        for (const [id, pending] of this.pendingInteractions.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Workflow cancelled'));
            this.pendingInteractions.delete(id);
        }

        this._emit('workflow:cancelled', { workflowId, surfaceId: state.surfaceId });

        return { success: true };
    }

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
            hasPendingInteraction: this.pendingInteractions.size > 0,
        };
    }

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

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    _emit(event, data) {
        if (this.eventBus && typeof this.eventBus.emit === 'function') {
            this.eventBus.emit(event, data);
        }
    }
}
