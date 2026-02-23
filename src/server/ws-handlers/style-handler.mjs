import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: set-ui-theme, set-ui-tokens, reset-ui-style, get-ui-style-state
 */

async function handleSetUITheme(data, ctx) {
    const { ws, assistant } = ctx;
    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
    if (uiStyleHandlers) {
        try {
            await uiStyleHandlers.setUITheme(data.payload);
        } catch (err) {
            wsSend(ws, 'error', { message: `Theme error: ${err.message}` });
        }
    }
}

async function handleSetUITokens(data, ctx) {
    const { ws, assistant } = ctx;
    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
    if (uiStyleHandlers) {
        try {
            await uiStyleHandlers.setUITokens(data.payload);
        } catch (err) {
            wsSend(ws, 'error', { message: `Token error: ${err.message}` });
        }
    }
}

async function handleResetUIStyle(data, ctx) {
    const { ws, assistant } = ctx;
    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
    if (uiStyleHandlers) {
        try {
            await uiStyleHandlers.resetUIStyle();
        } catch (err) {
            wsSend(ws, 'error', { message: `Reset error: ${err.message}` });
        }
    }
}

async function handleGetUIStyleState(data, ctx) {
    const { ws, assistant } = ctx;
    const uiStyleHandlers = assistant.toolExecutor?.uiStyleHandlers;
    if (uiStyleHandlers) {
        const state = await uiStyleHandlers.getUIStyleState();
        wsSend(ws, 'ui-style-state', JSON.parse(state));
    }
}

export const handlers = {
    'set-ui-theme': handleSetUITheme,
    'set-ui-tokens': handleSetUITokens,
    'reset-ui-style': handleResetUIStyle,
    'get-ui-style-state': handleGetUIStyleState
};
