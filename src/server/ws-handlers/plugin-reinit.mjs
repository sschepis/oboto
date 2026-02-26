/**
 * Re-initialize the plugin system after a workspace switch.
 *
 * Shared helper used by settings-handler, workspace-handler, and any
 * future handler that needs to reinit plugins on workspace change.
 *
 * @param {object} assistant — the EventicFacade instance
 * @param {object} ctx — WS handler context (must contain `.dispatcher`)
 * @param {Function} broadcast — (type, payload) => void
 * @param {string} [newWorkingDir] — the new workspace directory
 */
export async function reinitPlugins(assistant, ctx, broadcast, newWorkingDir) {
    if (!assistant.pluginManager) return;
    try {
        assistant.pluginManager.setWsDispatcher(ctx.dispatcher || null);
        assistant.pluginManager.setBroadcast(broadcast);
        await assistant.pluginManager.reinitialize({
            workingDir: newWorkingDir || assistant.workingDir
        });
        broadcast('plugin:list', { plugins: assistant.pluginManager.listPlugins() });
        broadcast('plugin:ui-manifest', assistant.pluginManager.getAllUIComponents());
    } catch (e) {
        const { consoleStyler } = await import('../../ui/console-styler.mjs');
        consoleStyler.log('warning', `Plugin re-initialization after workspace switch failed: ${e.message}`);
    }
}
