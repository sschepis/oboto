import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: set-ui-theme, set-ui-tokens, reset-ui-style, get-ui-style-state
 *
 * These WS message types are now handled by the ui-themes plugin which
 * registers its own WS handlers (plugin:ui-themes:set-ui-theme, etc.).
 *
 * The handlers below are kept as thin stubs for backward compatibility
 * with older UI clients that may still send the unprefixed message types.
 * They delegate to the plugin's registered tool handlers via the
 * ToolExecutor, which already has the plugin tools registered.
 */

async function handleSetUITheme(data, ctx) {
    const { ws, assistant } = ctx;
    const toolExecutor = assistant?.toolExecutor;
    if (!toolExecutor) return;
    try {
        const toolCall = {
            id: `compat-set-ui-theme-${Date.now()}`,
            function: { name: 'set_ui_theme', arguments: JSON.stringify(data.payload || {}) }
        };
        await toolExecutor.executeTool(toolCall);
    } catch (err) {
        wsSend(ws, 'error', { message: `Theme error: ${err.message}` });
    }
}

async function handleSetUITokens(data, ctx) {
    const { ws, assistant } = ctx;
    const toolExecutor = assistant?.toolExecutor;
    if (!toolExecutor) return;
    try {
        const toolCall = {
            id: `compat-set-ui-tokens-${Date.now()}`,
            function: { name: 'set_ui_tokens', arguments: JSON.stringify(data.payload || {}) }
        };
        await toolExecutor.executeTool(toolCall);
    } catch (err) {
        wsSend(ws, 'error', { message: `Token error: ${err.message}` });
    }
}

async function handleResetUIStyle(data, ctx) {
    const { ws, assistant } = ctx;
    const toolExecutor = assistant?.toolExecutor;
    if (!toolExecutor) return;
    try {
        const toolCall = {
            id: `compat-reset-ui-style-${Date.now()}`,
            function: { name: 'reset_ui_style', arguments: '{}' }
        };
        await toolExecutor.executeTool(toolCall);
    } catch (err) {
        wsSend(ws, 'error', { message: `Reset error: ${err.message}` });
    }
}

async function handleGetUIStyleState(data, ctx) {
    const { ws, assistant } = ctx;
    const toolExecutor = assistant?.toolExecutor;
    if (!toolExecutor) return;
    try {
        const toolCall = {
            id: `compat-get-ui-style-state-${Date.now()}`,
            function: { name: 'get_ui_style_state', arguments: '{}' }
        };
        const result = await toolExecutor.executeTool(toolCall);
        const content = result?.content ?? result ?? '';
        try {
            wsSend(ws, 'ui-style-state', JSON.parse(content));
        } catch {
            wsSend(ws, 'ui-style-state', {});
        }
    } catch (err) {
        wsSend(ws, 'error', { message: `Style state error: ${err.message}` });
    }
}

export const handlers = {
    'set-ui-theme': handleSetUITheme,
    'set-ui-tokens': handleSetUITokens,
    'reset-ui-style': handleResetUIStyle,
    'get-ui-style-state': handleGetUIStyleState
};
