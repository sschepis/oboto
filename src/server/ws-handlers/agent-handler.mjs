/**
 * WebSocket handlers for conversation-to-agent promotion and agent management.
 *
 * Message types handled:
 *   promote-conversation  — promote a conversation to a standalone agent
 *   list-agents           — list all promoted agents
 *   agent-message         — send instruction to a promoted agent
 *   terminate-agent       — terminate a promoted agent
 *   pause-agent           — pause a running agent
 *   resume-agent          — resume a paused agent
 *
 * @module src/server/ws-handlers/agent-handler
 */

import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handle: promote-conversation
 * Promotes a conversation to a standalone agent.
 */
async function handlePromoteConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const payload = data.payload || {};
        const {
            conversationName,
            agentName,
            mode = 'fork',
            instruction,
            persona,
            toolRestrictions,
        } = payload;

        if (!conversationName) {
            wsSendError(ws, 'Missing required field: conversationName');
            return;
        }

        const result = await assistant.promoteConversation({
            conversationName,
            agentName,
            mode,
            instruction,
            persona,
            toolRestrictions,
        });

        wsSend(ws, 'conversation-promoted', result);

        // Broadcast updated conversation list (in-place promotion marks conversations)
        const conversations = await assistant.listConversations();
        broadcast('conversation-list', conversations);

        consoleStyler.log('system', `🤖 Promoted conversation "${conversationName}" to agent "${result.agentName}" (${result.agentId})`);
    } catch (err) {
        consoleStyler.log('error', `Failed to promote conversation: ${err.message}`);
        wsSendError(ws, `Failed to promote conversation: ${err.message}`);
    }
}

/**
 * Handle: list-agents
 * Returns a list of all promoted agents with summary info.
 */
async function handleListAgents(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const agents = assistant.listPromotedAgents();
        wsSend(ws, 'agent-list', agents);
    } catch (err) {
        consoleStyler.log('error', `Failed to list agents: ${err.message}`);
        wsSendError(ws, `Failed to list agents: ${err.message}`);
    }
}

/**
 * Handle: agent-message
 * Sends an instruction/message to a promoted agent.
 */
async function handleAgentMessage(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const { agentId, message } = data.payload || {};

        if (!agentId || !message) {
            wsSendError(ws, 'Missing required fields: agentId, message');
            return;
        }

        // Validate agentId before kicking off async work — getAgentStatus
        // will throw synchronously if the ID is invalid.
        let status;
        try {
            status = assistant.getAgentStatus(agentId);
        } catch (statusErr) {
            wsSendError(ws, `Invalid agent: ${statusErr.message}`);
            return;
        }

        // Run async — the response will be delivered via agent-report event.
        // Guard ws.readyState in callbacks since the socket may close while
        // the agent processes the message.
        assistant.sendAgentMessage(agentId, message).then(response => {
            if (ws.readyState === 1) {
                wsSend(ws, 'agent-report', {
                    agentId,
                    report: response,
                    timestamp: new Date().toISOString(),
                });
            }
        }).catch(err => {
            if (ws.readyState === 1) {
                wsSendError(ws, `Agent message failed: ${err.message}`);
            }
        });

        // Immediate acknowledgment
        wsSend(ws, 'agent-status', status);
    } catch (err) {
        consoleStyler.log('error', `Failed to send agent message: ${err.message}`);
        wsSendError(ws, `Failed to send agent message: ${err.message}`);
    }
}

/**
 * Handle: terminate-agent
 * Terminates a promoted agent.
 */
async function handleTerminateAgent(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { agentId } = data.payload || {};

        if (!agentId) {
            wsSendError(ws, 'Missing required field: agentId');
            return;
        }

        const result = assistant.terminateAgent(agentId);
        wsSend(ws, 'agent-terminated', result);

        // Broadcast updated agent list
        const agents = assistant.listPromotedAgents();
        broadcast('agent-list', agents);

        consoleStyler.log('system', `🛑 Terminated agent "${agentId}"`);
    } catch (err) {
        consoleStyler.log('error', `Failed to terminate agent: ${err.message}`);
        wsSendError(ws, `Failed to terminate agent: ${err.message}`);
    }
}

/**
 * Handle: pause-agent
 * Pauses a running agent.
 */
async function handlePauseAgent(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const { agentId } = data.payload || {};

        if (!agentId) {
            wsSendError(ws, 'Missing required field: agentId');
            return;
        }

        const result = assistant.pauseAgent(agentId);
        wsSend(ws, 'agent-status', result);

        consoleStyler.log('system', `⏸️ Paused agent "${agentId}"`);
    } catch (err) {
        consoleStyler.log('error', `Failed to pause agent: ${err.message}`);
        wsSendError(ws, `Failed to pause agent: ${err.message}`);
    }
}

/**
 * Handle: resume-agent
 * Resumes a paused agent.
 */
async function handleResumeAgent(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const { agentId } = data.payload || {};

        if (!agentId) {
            wsSendError(ws, 'Missing required field: agentId');
            return;
        }

        const result = assistant.resumeAgent(agentId);
        wsSend(ws, 'agent-status', result);

        consoleStyler.log('system', `▶️ Resumed agent "${agentId}"`);
    } catch (err) {
        consoleStyler.log('error', `Failed to resume agent: ${err.message}`);
        wsSendError(ws, `Failed to resume agent: ${err.message}`);
    }
}

export const handlers = {
    'promote-conversation': handlePromoteConversation,
    'list-agents': handleListAgents,
    'agent-message': handleAgentMessage,
    'terminate-agent': handleTerminateAgent,
    'pause-agent': handlePauseAgent,
    'resume-agent': handleResumeAgent,
};
