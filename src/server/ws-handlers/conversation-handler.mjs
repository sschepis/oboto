import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: list-conversations, create-conversation, switch-conversation, delete-conversation
 */

async function handleListConversations(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const conversations = await assistant.listConversations();
        wsSend(ws, 'conversation-list', conversations);
    } catch (err) {
        consoleStyler.log('error', `Failed to list conversations: ${err.message}`);
        wsSendError(ctx.ws, `Failed to list conversations: ${err.message}`);
    }
}

async function handleCreateConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { name, autoSwitch } = data.payload;
        const result = await assistant.createConversation(name);
        wsSend(ws, 'conversation-created', result);
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
        wsSendError(ws, `Failed to create conversation: ${err.message}`);
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
            wsSendError(ws, result.error || `Failed to switch to conversation "${name}"`);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to switch conversation: ${err.message}`);
        wsSendError(ws, `Failed to switch conversation: ${err.message}`);
    }
}

async function handleDeleteConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { name } = data.payload;
        const result = await assistant.deleteConversation(name);
        wsSend(ws, 'conversation-deleted', result);
        if (result.deleted) {
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to delete conversation: ${err.message}`);
        wsSendError(ws, `Failed to delete conversation: ${err.message}`);
    }
}

async function handleClearConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { name } = data.payload || {};
        const result = await assistant.clearConversation(name || null);
        wsSend(ws, 'conversation-cleared', result);
        if (result.cleared) {
            // history-loaded is already emitted by ConversationController via eventBus
            // (forwarded through web-server.mjs with proper formatting).
            // Only broadcast the conversation list to update message counts in sidebar.
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to clear conversation: ${err.message}`);
        wsSendError(ws, `Failed to clear conversation: ${err.message}`);
    }
}

async function handleRenameConversation(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const { oldName, newName } = data.payload;
        const result = await assistant.renameConversation(oldName, newName);
        if (result.success) {
            wsSend(ws, 'conversation-renamed', { oldName: result.oldName, newName: result.newName });
            const conversations = await assistant.listConversations();
            broadcast('conversation-list', conversations);
        } else {
            wsSend(ws, 'error', { message: result.error });
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to rename conversation: ${err.message}`);
        wsSend(ws, 'error', { message: err.message });
    }
}

export const handlers = {
    'list-conversations': handleListConversations,
    'create-conversation': handleCreateConversation,
    'switch-conversation': handleSwitchConversation,
    'clear-conversation': handleClearConversation,
    'delete-conversation': handleDeleteConversation,
    'rename-conversation': handleRenameConversation
};
