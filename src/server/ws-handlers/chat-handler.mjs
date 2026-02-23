import { consoleStyler } from '../../ui/console-styler.mjs';
import { convertHistoryToUIMessages, processContentForUI } from '../ws-helpers.mjs';
import { isLLMAuthError, buildLLMAuthErrorPayload } from '../llm-error-detector.mjs';
import { wsSend } from '../../lib/ws-utils.mjs';

/**
 * Handles: chat, interrupt
 */

/** Helper: send an AI chat message via ws */
function sendAiMessage(ws, content, extra = {}) {
    wsSend(ws, 'message', {
        id: Date.now().toString(),
        role: 'ai',
        type: 'text',
        content,
        timestamp: new Date().toLocaleString(),
        ...extra
    });
}

async function handleChat(data, ctx) {
    const { ws, assistant, broadcast, agentLoopController, activeController: activeRef } = ctx;
    const userInput = data.payload;
    const activeSurfaceId = data.surfaceId || null;
    const modelOverride = data.model || null;
    consoleStyler.log('user', `Web User: ${userInput}${activeSurfaceId ? ` [surface: ${activeSurfaceId}]` : ''}${modelOverride ? ` [model: ${modelOverride}]` : ''}`);

    // Detect natural language requests to create a new conversation
    const newConvoMatch = userInput.match(/^(?:create|start|open|make|begin)\s+(?:a\s+)?new\s+(?:chat|conversation)(?:\s+(?:called|named)\s+["']?([a-zA-Z0-9_-]+)["']?)?$/i);
    if (newConvoMatch) {
        const name = newConvoMatch[1] || `chat-${Date.now().toString(36)}`;
        try {
            const result = await assistant.createConversation(name);
            if (result.created) {
                const switchResult = await assistant.switchConversation(result.name);
                if (switchResult.switched) {
                    const history = assistant.historyManager.getHistory();
                    const uiMessages = convertHistoryToUIMessages(history);
                    broadcast('history-loaded', uiMessages);
                    broadcast('conversation-switched', { name: result.name, switched: true });
                }
                const conversations = await assistant.listConversations();
                broadcast('conversation-list', conversations);
                sendAiMessage(ws, `✅ Created and switched to new conversation **"${result.name}"**. You can start chatting here!`);
            } else {
                sendAiMessage(ws, `⚠️ Could not create conversation: ${result.error}`);
            }
        } catch (err) {
            sendAiMessage(ws, `❌ Failed to create conversation: ${err.message}`);
        }
        return;
    }
    
    // ── Chime-in: If the agent is already working, queue the message ──
    if (activeRef.controller && assistant.isBusy()) {
        const queued = assistant.queueChimeIn(userInput);
        if (queued) {
            consoleStyler.log('system', `💬 User chimed in while agent is working: "${userInput.substring(0, 80)}..."`);
            
            wsSend(ws, 'message', {
                id: Date.now().toString(),
                role: 'user',
                type: 'text',
                content: userInput,
                timestamp: new Date().toLocaleString(),
                isChimeIn: true
            });

            sendAiMessage(ws, '💬 *Message queued — the agent will incorporate this update during its current task.*', { id: (Date.now() + 1).toString(), isChimeInAck: true });
            return;
        }
    }

    wsSend(ws, 'status', 'working');

    if (agentLoopController) agentLoopController.setForegroundBusy(true);

    if (activeRef.controller) {
        activeRef.controller.abort();
    }
    activeRef.controller = new AbortController();

    // Build surface context prefix if a surface is focused
    let surfaceContextInput = userInput;
    if (activeSurfaceId && assistant.toolExecutor?.surfaceManager) {
        try {
            const surface = await assistant.toolExecutor.surfaceManager.getSurface(activeSurfaceId);
            if (surface) {
                const componentNames = surface.components.map(c => c.name).join(', ') || 'none';
                let layoutDesc;
                if (typeof surface.layout === 'object' && surface.layout?.type === 'flex-grid') {
                    const cellIds = [];
                    for (const row of surface.layout.rows) {
                        for (const cell of row.cells) {
                            cellIds.push(`${cell.id}[${cell.components.join(',') || 'empty'}]`);
                        }
                    }
                    layoutDesc = `flex-grid(cells: ${cellIds.join(', ')})`;
                } else {
                    layoutDesc = surface.layout || 'vertical';
                }
                surfaceContextInput = `[Active Surface: "${surface.name}" (ID: ${activeSurfaceId}, layout: ${layoutDesc}, components: ${componentNames})]\n\n${userInput}`;
            }
        } catch (e) {
            // Ignore surface lookup errors — proceed without context
        }
    }

    try {
        const responseText = await assistant.run(surfaceContextInput, { signal: activeRef.controller.signal, model: modelOverride });
        
        sendAiMessage(ws, processContentForUI(responseText));

        await assistant.generateNextSteps();
    } catch (err) {
        if (err.name === 'AbortError' || err.message.includes('cancelled')) {
            consoleStyler.log('system', 'Task execution cancelled by user');
            sendAiMessage(ws, '🛑 Task cancelled.');
        } else if (isLLMAuthError(err)) {
            consoleStyler.log('error', `LLM auth error detected: ${err.message}`);
            const payload = buildLLMAuthErrorPayload(err, 'chat');
            broadcast('llm-auth-error', payload);
            sendAiMessage(ws, `🔑 **LLM API Key Error**\n\n${payload.suggestion}\n\n_Original error: ${payload.errorMessage}_`);
        } else {
            throw err;
        }
    } finally {
        activeRef.controller = null;
        if (agentLoopController) agentLoopController.setForegroundBusy(false);
        wsSend(ws, 'status', 'idle');
    }
}

async function handleInterrupt(data, ctx) {
    const { ws, broadcast, agentLoopController, activeController: activeRef } = ctx;
    consoleStyler.log('system', '🛑 Received interrupt signal — shutting down current request');
    if (activeRef.controller) {
        activeRef.controller.abort();
        activeRef.controller = null;
        consoleStyler.log('system', '🛑 AbortController fired — request pipeline will terminate');
    } else {
        consoleStyler.log('system', '🛑 No active request to interrupt');
    }
    if (agentLoopController) agentLoopController.setForegroundBusy(false);
    wsSend(ws, 'status', 'idle');
    broadcast('log', { level: 'status', message: 'Request interrupted by user' });
}

export const handlers = {
    'chat': handleChat,
    'interrupt': handleInterrupt
};
