/**
 * Handles: start-workflow, submit-interaction, cancel-workflow,
 *          get-workflow-status, list-workflows
 */

async function handleStartWorkflow(data, ctx) {
    const { ws, assistant } = ctx;
    const workflowService = assistant.toolExecutor?.workflowService;
    if (workflowService) {
        try {
            const { surfaceId, flowScript, flowName } = data.payload;
            const result = await workflowService.startWorkflow(surfaceId, flowScript, flowName);
            ws.send(JSON.stringify({ type: 'workflow-started', payload: result }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to start workflow: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
    }
}

async function handleSubmitInteraction(data, ctx) {
    const { ws, assistant } = ctx;
    const workflowService = assistant.toolExecutor?.workflowService;
    if (workflowService) {
        try {
            const { workflowId, interactionId, data: interactionData } = data.payload;
            const result = await workflowService.submitInteraction(workflowId, interactionId, interactionData);
            ws.send(JSON.stringify({ type: 'workflow-interaction-submitted', payload: result }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to submit interaction: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
    }
}

async function handleCancelWorkflow(data, ctx) {
    const { ws, assistant } = ctx;
    const workflowService = assistant.toolExecutor?.workflowService;
    if (workflowService) {
        try {
            const { workflowId } = data.payload;
            const result = await workflowService.cancelWorkflow(workflowId);
            ws.send(JSON.stringify({ type: 'workflow-cancelled', payload: result }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to cancel workflow: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
    }
}

async function handleGetWorkflowStatus(data, ctx) {
    const { ws, assistant } = ctx;
    const workflowService = assistant.toolExecutor?.workflowService;
    if (workflowService) {
        try {
            const { workflowId } = data.payload;
            const status = await workflowService.getWorkflowStatus(workflowId);
            ws.send(JSON.stringify({ type: 'workflow-status', payload: status }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to get workflow status: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Workflow service not available' }));
    }
}

async function handleListWorkflows(data, ctx) {
    const { ws, assistant } = ctx;
    const workflowService = assistant.toolExecutor?.workflowService;
    if (workflowService) {
        try {
            const result = await workflowService.listWorkflows();
            ws.send(JSON.stringify({ type: 'workflow-list', payload: result }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to list workflows: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'workflow-list', payload: [] }));
    }
}

export const handlers = {
    'start-workflow': handleStartWorkflow,
    'submit-interaction': handleSubmitInteraction,
    'cancel-workflow': handleCancelWorkflow,
    'get-workflow-status': handleGetWorkflowStatus,
    'list-workflows': handleListWorkflows
};
