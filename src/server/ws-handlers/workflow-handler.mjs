import { wsSend, wsSendError, wsHandler } from '../../lib/ws-utils.mjs';

/**
 * Handles: start-workflow, submit-interaction, cancel-workflow,
 *          get-workflow-status, list-workflows
 */

const handleStartWorkflow = wsHandler(async (data, ctx, svc) => {
    const { ws } = ctx;
    const { surfaceId, flowScript, flowName } = data.payload;
    const result = await svc.startWorkflow(surfaceId, flowScript, flowName);
    wsSend(ws, 'workflow-started', result);
}, { require: 'toolExecutor.workflowService', requireLabel: 'Workflow service', errorPrefix: 'Failed to start workflow' });

const handleSubmitInteraction = wsHandler(async (data, ctx, svc) => {
    const { ws } = ctx;
    const { workflowId, interactionId, data: interactionData } = data.payload;
    const result = await svc.submitInteraction(workflowId, interactionId, interactionData);
    wsSend(ws, 'workflow-interaction-submitted', result);
}, { require: 'toolExecutor.workflowService', requireLabel: 'Workflow service', errorPrefix: 'Failed to submit interaction' });

const handleCancelWorkflow = wsHandler(async (data, ctx, svc) => {
    const { ws } = ctx;
    const { workflowId } = data.payload;
    const result = await svc.cancelWorkflow(workflowId);
    wsSend(ws, 'workflow-cancelled', result);
}, { require: 'toolExecutor.workflowService', requireLabel: 'Workflow service', errorPrefix: 'Failed to cancel workflow' });

const handleGetWorkflowStatus = wsHandler(async (data, ctx, svc) => {
    const { ws } = ctx;
    const { workflowId } = data.payload;
    const status = await svc.getWorkflowStatus(workflowId);
    wsSend(ws, 'workflow-status', status);
}, { require: 'toolExecutor.workflowService', requireLabel: 'Workflow service', errorPrefix: 'Failed to get workflow status' });

async function handleListWorkflows(data, ctx) {
    const { ws, assistant } = ctx;
    const workflowService = assistant.toolExecutor?.workflowService;
    if (workflowService) {
        try {
            const result = await workflowService.listWorkflows();
            wsSend(ws, 'workflow-list', result);
        } catch (err) {
            wsSendError(ws, `Failed to list workflows: ${err.message}`);
        }
    } else {
        wsSend(ws, 'workflow-list', []);
    }
}

export const handlers = {
    'start-workflow': handleStartWorkflow,
    'submit-interaction': handleSubmitInteraction,
    'cancel-workflow': handleCancelWorkflow,
    'get-workflow-status': handleGetWorkflowStatus,
    'list-workflows': handleListWorkflows
};
