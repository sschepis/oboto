import { consoleStyler } from '../../ui/console-styler.mjs';
import { convertHistoryToUIMessages } from '../ws-helpers.mjs';
import { isLLMAuthError, buildLLMAuthErrorPayload } from '../llm-error-detector.mjs';

/**
 * Handles: chat, interrupt
 */

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
                // Auto-switch to the new conversation
                const switchResult = await assistant.switchConversation(result.name);
                if (switchResult.switched) {
                    // Send history (empty for new conversation)
                    const history = assistant.historyManager.getHistory();
                    const uiMessages = convertHistoryToUIMessages(history);
                    broadcast('history-loaded', uiMessages);
                    broadcast('conversation-switched', { name: result.name, switched: true });
                }
                // Refresh conversation list
                const conversations = await assistant.listConversations();
                broadcast('conversation-list', conversations);
                // Inform user
                ws.send(JSON.stringify({
                    type: 'message',
                    payload: {
                        id: Date.now().toString(),
                        role: 'ai',
                        type: 'text',
                        content: `✅ Created and switched to new conversation **"${result.name}"**. You can start chatting here!`,
                        timestamp: new Date().toLocaleTimeString()
                    }
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'message',
                    payload: {
                        id: Date.now().toString(),
                        role: 'ai',
                        type: 'text',
                        content: `⚠️ Could not create conversation: ${result.error}`,
                        timestamp: new Date().toLocaleTimeString()
                    }
                }));
            }
        } catch (err) {
            ws.send(JSON.stringify({
                type: 'message',
                payload: {
                    id: Date.now().toString(),
                    role: 'ai',
                    type: 'text',
                    content: `❌ Failed to create conversation: ${err.message}`,
                    timestamp: new Date().toLocaleTimeString()
                }
            }));
        }
        return;
    }
    
    // Simulate thinking
    ws.send(JSON.stringify({ type: 'status', payload: 'working' }));

    // Signal foreground activity to agent loop
    if (agentLoopController) agentLoopController.setForegroundBusy(true);

    // Cancel any previous active task
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

    // Run assistant
    try {
        const responseText = await assistant.run(surfaceContextInput, { signal: activeRef.controller.signal, model: modelOverride });
        
        // Send response back
        ws.send(JSON.stringify({
            type: 'message',
            payload: {
                id: Date.now().toString(),
                role: 'ai',
                type: 'text',
                content: responseText,
                timestamp: new Date().toLocaleTimeString()
            }
        }));

        // Generate and broadcast next steps AFTER the response
        await assistant.generateNextSteps();
    } catch (err) {
        if (err.name === 'AbortError' || err.message.includes('cancelled')) {
            consoleStyler.log('system', 'Task execution cancelled by user');
            ws.send(JSON.stringify({
                type: 'message',
                payload: {
                    id: Date.now().toString(),
                    role: 'ai',
                    type: 'text',
                    content: '🛑 Task cancelled.',
                    timestamp: new Date().toLocaleTimeString()
                }
            }));
        } else if (isLLMAuthError(err)) {
            // LLM authentication / API key error — redirect to secrets config
            consoleStyler.log('error', `LLM auth error detected: ${err.message}`);
            const payload = buildLLMAuthErrorPayload(err, 'chat');
            // Broadcast to ALL clients so any connected UI shows the secrets view
            broadcast('llm-auth-error', payload);
            // Also send an error message to the requesting client's chat
            ws.send(JSON.stringify({
                type: 'message',
                payload: {
                    id: Date.now().toString(),
                    role: 'ai',
                    type: 'text',
                    content: `🔑 **LLM API Key Error**\n\n${payload.suggestion}\n\n_Original error: ${payload.errorMessage}_`,
                    timestamp: new Date().toLocaleTimeString()
                }
            }));
        } else {
            throw err; // Re-throw to be caught by outer catch
        }
    } finally {
        activeRef.controller = null;
        if (agentLoopController) agentLoopController.setForegroundBusy(false);
        ws.send(JSON.stringify({ type: 'status', payload: 'idle' }));
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
    // Always transition to idle and notify client
    if (agentLoopController) agentLoopController.setForegroundBusy(false);
    ws.send(JSON.stringify({ type: 'status', payload: 'idle' }));
    // Broadcast an explicit "interrupted" log so the UI sees it in the activity feed
    broadcast('log', { level: 'status', message: 'Request interrupted by user' });
}

export const handlers = {
    'chat': handleChat,
    'interrupt': handleInterrupt
};
