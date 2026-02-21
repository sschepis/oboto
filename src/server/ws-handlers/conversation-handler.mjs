import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Handles: list-conversations, create-conversation, switch-conversation, delete-conversation
 */

async function handleListConversations(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const conversations = await assistant.listConversations();
        ws.send(JSON.stringify({ type: 'conversation-list', payload: conversations }));
    } catch (err) {
        consoleStyler.log('error', `Failed to list conversations: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to list conversations: ${err.message}` }));
    }
}

async function handleCreateConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { name, autoSwitch } = data.payload;
        const result = await assistant.createConversation(name);
        ws.send(JSON.stringify({ type: 'conversation-created', payload: result }));
        if (result.created) {
            // Auto-switch to new conversation (default behavior)
            if (autoSwitch !== false) {
                try {
                    await assistant.switchConversation(result.name);
                } catch (switchErr) {
                    consoleStyler.log('warning', `Auto-switch after create failed: ${switchErr.message}`);
                    // Fallback: manually broadcast the switch events
                    broadcast('conversation-switched', { name: result.name, switched: true });
                    broadcast('history-loaded', []);
                }
            }
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to create conversation: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to create conversation: ${err.message}` }));
    }
}

async function handleSwitchConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { name } = data.payload;
        const result = await assistant.switchConversation(name);
        // Note: assistant.switchConversation() (via ConversationController) already
        // emits server:history-loaded and server:conversation-switched via eventBus,
        // which the web-server forwards as broadcasts. We only need to send the
        // conversation list here (not emitted by the controller for switches).
        if (result.switched) {
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        } else {
            // If switch failed, notify the requesting client
            ws.send(JSON.stringify({ type: 'error', payload: result.error || `Failed to switch to conversation "${name}"` }));
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to switch conversation: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to switch conversation: ${err.message}` }));
    }
}

async function handleDeleteConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { name } = data.payload;
        const result = await assistant.deleteConversation(name);
        ws.send(JSON.stringify({ type: 'conversation-deleted', payload: result }));
        if (result.deleted) {
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to delete conversation: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to delete conversation: ${err.message}` }));
    }
}

async function handleRenameConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { oldName, newName } = data.payload;
        const result = await assistant.renameConversation(oldName, newName);
        if (result.success) {
            ws.send(JSON.stringify({ type: 'conversation-renamed', payload: { oldName: result.oldName, newName: result.newName } }));
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        } else {
            ws.send(JSON.stringify({ type: 'error', payload: { message: result.error } }));
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to rename conversation: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: { message: err.message } }));
    }
}

export const handlers = {
    'list-conversations': handleListConversations,
    'create-conversation': handleCreateConversation,
    'switch-conversation': handleSwitchConversation,
    'delete-conversation': handleDeleteConversation,
    'rename-conversation': handleRenameConversation
};
