/**
 * Handlers for BubbleLab workflow-surface tools.
 * These handle the execution of workflow management tool calls from the AI agent.
 */
export class WorkflowSurfaceHandlers {
    constructor(workflowService, eventBus) {
        this.workflowService = workflowService;
        this.eventBus = eventBus;
    }

    async startSurfaceWorkflow(args) {
        try {
            const { surface_id, flow_script, trigger_payload } = args;

            if (!this.workflowService) {
                return 'WorkflowService not available. BubbleLab integration may not be configured.';
            }

            const result = await this.workflowService.startWorkflow(
                flow_script,
                surface_id,
                trigger_payload || {}
            );

            return `Workflow started successfully.\nWorkflow ID: ${result.workflowId}\nBound to Surface: ${surface_id}\n\nThe workflow is now executing in the background. Use get_workflow_status to check progress.`;
        } catch (error) {
            return `Error starting workflow: ${error.message}`;
        }
    }

    async getWorkflowStatus(args) {
        try {
            const { workflow_id } = args;

            if (!this.workflowService) {
                return 'WorkflowService not available.';
            }

            const status = this.workflowService.getWorkflowStatus(workflow_id);
            if (!status) {
                return `Workflow '${workflow_id}' not found.`;
            }

            const lines = [
                `Workflow: ${status.workflowId}`,
                `Surface: ${status.surfaceId}`,
                `Status: ${status.status}`,
                `Started: ${status.startedAt}`,
            ];

            if (status.completedAt) {
                lines.push(`Completed: ${status.completedAt}`);
            }
            if (status.error) {
                lines.push(`Error: ${status.error}`);
            }
            if (status.hasPendingInteraction) {
                lines.push(`⏳ Waiting for user interaction`);
            }

            return lines.join('\n');
        } catch (error) {
            return `Error getting workflow status: ${error.message}`;
        }
    }

    async listWorkflows(args) {
        try {
            if (!this.workflowService) {
                return 'WorkflowService not available.';
            }

            const workflows = this.workflowService.listWorkflows();
            if (workflows.length === 0) {
                return 'No active workflows.';
            }

            const list = workflows.map(w =>
                `- ${w.workflowId} [${w.status}] → Surface ${w.surfaceId} (started ${w.startedAt})`
            ).join('\n');

            return `Active Workflows:\n${list}`;
        } catch (error) {
            return `Error listing workflows: ${error.message}`;
        }
    }

    async cancelWorkflow(args) {
        try {
            const { workflow_id } = args;

            if (!this.workflowService) {
                return 'WorkflowService not available.';
            }

            await this.workflowService.cancelWorkflow(workflow_id);
            return `Workflow '${workflow_id}' cancelled successfully.`;
        } catch (error) {
            return `Error cancelling workflow: ${error.message}`;
        }
    }

    async submitWorkflowInteraction(args) {
        try {
            const { workflow_id, interaction_id, data } = args;

            if (!this.workflowService) {
                return 'WorkflowService not available.';
            }

            await this.workflowService.submitInteraction(workflow_id, interaction_id, data);
            return `Interaction submitted. Workflow '${workflow_id}' is resuming.`;
        } catch (error) {
            return `Error submitting interaction: ${error.message}`;
        }
    }
}
