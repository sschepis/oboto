/**
 * Handles: agent-loop-play, agent-loop-pause, agent-loop-stop,
 *          agent-loop-set-interval, get-agent-loop-state, agent-loop-answer
 */

async function handleAgentLoopPlay(data, ctx) {
    const { agentLoopController } = ctx;
    if (agentLoopController) {
        const intervalMs = data.payload?.intervalMs;
        agentLoopController.play(intervalMs);
    }
}

async function handleAgentLoopPause(data, ctx) {
    const { agentLoopController } = ctx;
    if (agentLoopController) {
        agentLoopController.pause();
    }
}

async function handleAgentLoopStop(data, ctx) {
    const { agentLoopController } = ctx;
    if (agentLoopController) {
        agentLoopController.stop();
    }
}

async function handleAgentLoopSetInterval(data, ctx) {
    const { agentLoopController } = ctx;
    if (agentLoopController) {
        const intervalMs = data.payload?.intervalMs;
        if (intervalMs) agentLoopController.setInterval(intervalMs);
    }
}

async function handleGetAgentLoopState(data, ctx) {
    const { ws, agentLoopController } = ctx;
    if (agentLoopController) {
        ws.send(JSON.stringify({ type: 'agent-loop-state', payload: agentLoopController.getState() }));
    } else {
        // Return a disabled state if no controller exists
        ws.send(JSON.stringify({ type: 'agent-loop-state', payload: { state: 'stopped', intervalMs: 180000, invocationCount: 0, pendingQuestions: [] } }));
    }
}

async function handleAgentLoopAnswer(data, ctx) {
    const { ws, agentLoopController } = ctx;
    if (agentLoopController) {
        // User is answering a blocking question from the background agent
        const { questionId, answer } = data.payload;
        if (questionId && answer) {
            agentLoopController.resolveQuestion(questionId, answer);
            ws.send(JSON.stringify({ type: 'status', payload: 'Answer sent to background agent' }));
        } else {
            ws.send(JSON.stringify({ type: 'error', payload: 'Missing questionId or answer' }));
        }
    }
}

export const handlers = {
    'agent-loop-play': handleAgentLoopPlay,
    'agent-loop-pause': handleAgentLoopPause,
    'agent-loop-stop': handleAgentLoopStop,
    'agent-loop-set-interval': handleAgentLoopSetInterval,
    'get-agent-loop-state': handleGetAgentLoopState,
    'agent-loop-answer': handleAgentLoopAnswer
};
