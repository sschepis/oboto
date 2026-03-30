import { consoleStyler } from '../../ui/console-styler.mjs';
import { convertHistoryToUIMessages, processContentForUI } from '../ws-helpers.mjs';
import { isLLMAuthError, buildLLMAuthErrorPayload } from '../llm-error-detector.mjs';
import { wsSend } from '../../lib/ws-utils.mjs';
import { generateSimpleId } from '../../lib/id-utils.mjs';

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
    const userInput = typeof data.payload === 'string' ? data.payload : (data.payload?.message || '');
    const activeSurfaceId = data.surfaceId || null;
    const modelOverride = data.model || (typeof data.payload === 'object' ? data.payload?.model : null) || null;

    // Resolve the target conversation from the message or the client's active conversation.
    const conversationId = data.conversationId || ws._activeConversation || assistant?.getActiveConversationName?.() || 'chat';
    const convCtx = assistant?.conversationManager?.getConversationContext?.(conversationId) || null;
    consoleStyler.log('user', `Web User [${conversationId}]: ${userInput}${activeSurfaceId ? ` [surface: ${activeSurfaceId}]` : ''}${modelOverride ? ` [model: ${modelOverride}]` : ''}`);

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

    // Detect natural language requests to promote a conversation to an agent
    const promoteMatch = userInput.match(
        /^(?:promote|make|turn|fork|convert)\s+(?:this\s+)?(?:conversation|chat|convo)\s+(?:to|into|as)\s+(?:an?\s+)?agent(?:\s+(?:called|named)\s+["']?([a-zA-Z0-9_-]+)["']?)?$/i
    );
    if (promoteMatch) {
        const agentName = promoteMatch[1] || undefined;
        try {
            const result = await assistant.promoteConversation({
                conversationName: conversationId,
                agentName,
                mode: 'fork',
            });
            sendAiMessage(ws, `🤖 Promoted this conversation to agent **"${result.agentName}"** (ID: \`${result.agentId}\`). The agent is now running independently with a copy of our conversation history.`);
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        } catch (err) {
            sendAiMessage(ws, `❌ Failed to promote conversation: ${err.message}`);
        }
        return;
    }
    
    // ── @mention routing: forward to mentioned agents ──
    const mentionedAgents = (typeof data.payload === 'object' && Array.isArray(data.payload?.mentionedAgents))
        ? data.payload.mentionedAgents
        : [];
    if (mentionedAgents.length > 0 && assistant?.sendAgentMessage) {
        for (const agentId of mentionedAgents) {
            try {
                // Fire and forget — the agent-report event will deliver the response
                assistant.sendAgentMessage(agentId, userInput).then(response => {
                    if (ws.readyState === 1) {
                        wsSend(ws, 'agent-report', {
                            agentId,
                            report: response,
                            timestamp: new Date().toISOString(),
                        });
                    }
                }).catch(err => {
                    if (ws.readyState === 1) {
                        wsSend(ws, 'error', { message: `Agent ${agentId} failed: ${err.message}` });
                    }
                });
                consoleStyler.log('system', `📬 Forwarded message to mentioned agent "${agentId}"`);
            } catch (err) {
                consoleStyler.log('error', `Failed to forward to agent "${agentId}": ${err.message}`);
            }
        }
        // Don't return — let the main chat still process normally
    }

    // ── Chime-in: If the target conversation is busy, queue the message ──
    const isBusy = convCtx ? convCtx.isBusy : (activeRef.controller && assistant.isBusy());
    if (isBusy) {
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

    // Inject file attachment context so the agent knows about uploaded files.
    // Sanitize name/path to prevent prompt injection via crafted WebSocket payloads.
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
    const safeAttachments = attachments
        .filter(a => typeof a.name === 'string' && typeof a.path === 'string')
        .map(a => ({
            name: a.name.replace(/[\[\]\n\r]/g, '').substring(0, 255),
            path: a.path.substring(0, 1024),
        }));
    if (safeAttachments.length > 0) {
        const attachContext = safeAttachments.map(a =>
            `[The user attached a file: "${a.name}" saved at path "${a.path}". You can read it with the read_file tool.]`
        ).join('\n');
        surfaceContextInput = `${surfaceContextInput}\n\n${attachContext}`;
    }

    // ── Streaming setup ─────────────────────────────────────────────────
    const streamMsgId = generateSimpleId('stream');
    let streamStarted = false;

    // Mark the conversation context as busy so other operations know
    // this conversation is being worked on.
    if (convCtx) convCtx.markBusy();

    // Begin tracking an in-progress message on the HistoryManager so that
    // partial streaming content is periodically flushed to disk and can be
    // recovered if the server crashes mid-stream.
    // Use the conversation-specific history manager when available.
    const hm = convCtx ? convCtx.historyManager : assistant.historyManager;
    hm.beginInProgressMessage('assistant');

    // Chunk batching: buffer incoming tokens and flush every BATCH_INTERVAL_MS
    // to avoid sending hundreds of tiny WS messages per second.
    const BATCH_INTERVAL_MS = 50;
    let chunkBuffer = '';
    let batchTimer = null;

    const flushChunkBuffer = () => {
        batchTimer = null;
        try {
            if (ws.readyState !== 1 || !chunkBuffer) return; // 1 === WebSocket.OPEN
            wsSend(ws, 'message-stream-chunk', {
                id: streamMsgId,
                delta: chunkBuffer
            });
            chunkBuffer = '';
        } catch { /* ws may have been destroyed between timer scheduling and firing */ }
    };

    /** Callback invoked per-token by the agent pipeline. */
    const onChunk = (delta) => {
        // Guard: if the request was aborted mid-stream, stop emitting.
        if (activeRef.controller?.signal?.aborted) return;
        // Guard: don't queue chunks for a closed/closing WebSocket
        if (ws.readyState !== 1) return; // 1 === WebSocket.OPEN

        if (!streamStarted) {
            streamStarted = true;
            wsSend(ws, 'message-stream-start', {
                id: streamMsgId,
                role: 'ai',
                timestamp: new Date().toLocaleString()
            });
        }

        // Accumulate into the in-progress message for crash recovery.
        // This triggers a debounced disk save every ~5 seconds.
        hm.appendToInProgressMessage(delta);

        chunkBuffer += delta;
        if (!batchTimer) {
            batchTimer = setTimeout(flushChunkBuffer, BATCH_INTERVAL_MS);
        }
    };

    try {
        const responseText = await assistant.run(surfaceContextInput, {
            signal: activeRef.controller.signal,
            model: modelOverride,
            ws,
            onChunk,
            // Pass conversation-scoped AI provider history when available
            ...(convCtx ? { conversationHistory: convCtx.aiProviderHistory } : {})
        });
        
        // Read token usage stored by the facade during run()
        const tokenUsage = assistant._lastTokenUsage || null;

        if (streamStarted) {
            // Flush any remaining buffered chunks before closing
            if (batchTimer) clearTimeout(batchTimer);
            flushChunkBuffer();
            // Streaming occurred — send the final end event with processed content
            wsSend(ws, 'message-stream-end', {
                id: streamMsgId,
                content: processContentForUI(responseText),
                ...(tokenUsage ? { tokenUsage } : {})
            });
        } else {
            // No streaming occurred (e.g. provider doesn't support it) — fallback
            sendAiMessage(ws, processContentForUI(responseText), tokenUsage ? { tokenUsage } : {});
        }

        // The agentic provider already added user + assistant messages to
        // historyManager.  The in-progress message was just a crash-recovery
        // shadow — discard it now (the canonical message is already in history).
        // Use keepPartial=false since the full response is already committed.
        hm.discardInProgressMessage(false);

        // Persist the conversation to disk as a safety net.
        // Runs in background to avoid blocking the UI status transition to 'idle'.
        assistant.saveConversation().catch((e) => {
            consoleStyler.log('error', `Failed to save conversation: ${e.message}`);
        });

        // Fire-and-forget: generate context-aware next-step suggestions
        // using the conversation exchange. Not awaited so it doesn't block
        // the status transition to 'idle'.
        assistant.generateNextSteps(userInput, responseText).catch(() => {});
    } catch (err) {
        // Clear any pending batch timer on error
        if (batchTimer) clearTimeout(batchTimer);

        // Preserve any partial streaming content so it survives the error.
        // keepPartial=true commits the accumulated text to history with an
        // "[interrupted]" marker — this is the critical crash-recovery path.
        hm.discardInProgressMessage(/* keepPartial */ true);

        if (err.name === 'AbortError' || err.message?.includes('cancelled') || err.message?.includes('aborted')) {
            consoleStyler.log('system', 'Task execution cancelled by user');
            if (streamStarted) {
                flushChunkBuffer();
                // Close the stream gracefully with interrupted flag
                wsSend(ws, 'message-stream-end', {
                    id: streamMsgId,
                    content: '',
                    interrupted: true
                });
            } else {
                sendAiMessage(ws, '🛑 Task cancelled.');
            }
        } else if (isLLMAuthError(err)) {
            consoleStyler.log('error', `LLM auth error detected: ${err.message}`);
            const payload = buildLLMAuthErrorPayload(err, 'chat');
            broadcast('llm-auth-error', payload);
            if (streamStarted) {
                flushChunkBuffer();
                wsSend(ws, 'message-stream-end', {
                    id: streamMsgId,
                    content: `🔑 **LLM API Key Error**\n\n${payload.suggestion}`,
                    interrupted: true
                });
            } else {
                sendAiMessage(ws, `🔑 **LLM API Key Error**\n\n${payload.suggestion}\n\n_Original error: ${payload.errorMessage}_`);
            }
        } else {
            // Catch-all: log and notify the user instead of crashing the server
            consoleStyler.log('error', `Chat error: ${err.message || err}`);
            if (streamStarted) {
                flushChunkBuffer();
                wsSend(ws, 'message-stream-end', {
                    id: streamMsgId,
                    content: `❌ An error occurred: ${err.message || 'Unknown error'}`,
                    interrupted: true
                });
            } else {
                sendAiMessage(ws, `❌ An error occurred: ${err.message || 'Unknown error'}`);
            }
        }
        // Persist conversation with the recovered partial content
        assistant.saveConversation().catch(() => {});
    } finally {
        // Safety net: ensure batch timer is always cleaned up
        if (batchTimer) clearTimeout(batchTimer);
        activeRef.controller = null;
        // Mark conversation context as idle so other operations can proceed
        if (convCtx) convCtx.markIdle();
        if (agentLoopController) agentLoopController.setForegroundBusy(false);
        wsSend(ws, 'status', 'idle');
    }
}

async function handleInterrupt(data, ctx) {
    const { ws, broadcast, agentLoopController, activeController: activeRef } = ctx;
    consoleStyler.log('system', '🛑 Received interrupt signal — shutting down current request');
    if (activeRef.controller) {
        activeRef.controller.abort();
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
    'interrupt': handleInterrupt,
    'stop': handleInterrupt,
    'cancel': handleInterrupt
};
