/**
 * WebSocket handlers for plugin management.
 * 
 * Allows the frontend to:
 * - List plugins and their status
 * - Enable/disable plugins
 * - Reload plugins
 * - Get plugin UI manifests
 * - Get plugin component sources
 * - Update plugin settings
 * 
 * @module src/server/ws-handlers/plugin-handler
 */

/**
 * Resolve the PluginManager from the WS context.
 * @param {object} ctx
 * @returns {import('../../plugins/plugin-manager.mjs').PluginManager|null}
 */
function getPluginManager(ctx) {
    return ctx.pluginManager || ctx.assistant?.pluginManager || ctx.assistant?._services?.get('pluginManager') || null;
}

/**
 * Check if the request is coming from a local client.
 * For now, we consider the request authorized if the WebSocket connection
 * originated from localhost. This prevents remote attackers from managing
 * plugins when the server is exposed on a network interface.
 *
 * @param {object} ctx
 * @returns {boolean}
 */
function isLocalRequest(ctx) {
    const ws = ctx.ws;
    const req = ws?._req;
    // If behind a reverse proxy, the remoteAddress is the proxy — not the client.
    // Default to DENY when X-Forwarded-For is present unless we have an explicit
    // trusted-proxy configuration (not implemented yet).
    if (req?.headers?.['x-forwarded-for']) {
        return false;
    }
    const addr =
        req?.socket?.remoteAddress
        || ws?._socket?.remoteAddress
        || null;
    if (!addr) return false;
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export const handlers = {
    /**
     * List all discovered plugins with status.
     */
    'plugin:list': async (data, ctx) => {
        const { ws } = ctx;
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({
                type: 'plugin:list',
                payload: { plugins: [], error: 'Plugin system not initialized' }
            }));
            return;
        }

        const plugins = pluginManager.listPlugins();
        ws.send(JSON.stringify({
            type: 'plugin:list',
            payload: { plugins }
        }));
    },

    /**
     * Enable a plugin.
     */
    'plugin:enable': async (data, ctx) => {
        const { ws, broadcast } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name } = data;
        if (!name) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin name required' } }));
            return;
        }

        const success = await pluginManager.enablePlugin(name);
        const plugins = pluginManager.listPlugins();

        broadcast('plugin:list', { plugins });
        broadcast('plugin:ui-manifest', pluginManager.getAllUIComponents());

        ws.send(JSON.stringify({
            type: 'plugin:enabled',
            payload: { name, success }
        }));
    },

    /**
     * Disable a plugin.
     */
    'plugin:disable': async (data, ctx) => {
        const { ws, broadcast } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name } = data;
        if (!name) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin name required' } }));
            return;
        }

        const success = await pluginManager.disablePlugin(name);
        const plugins = pluginManager.listPlugins();

        broadcast('plugin:list', { plugins });
        broadcast('plugin:ui-manifest', pluginManager.getAllUIComponents());

        ws.send(JSON.stringify({
            type: 'plugin:disabled',
            payload: { name, success }
        }));
    },

    /**
     * Reload a plugin.
     */
    'plugin:reload': async (data, ctx) => {
        const { ws, broadcast } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name } = data;
        if (!name) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin name required' } }));
            return;
        }

        const success = await pluginManager.reloadPlugin(name);
        const plugins = pluginManager.listPlugins();

        broadcast('plugin:list', { plugins });
        broadcast('plugin:ui-manifest', pluginManager.getAllUIComponents());

        ws.send(JSON.stringify({
            type: 'plugin:reloaded',
            payload: { name, success }
        }));
    },

    /**
     * Get the aggregated UI manifest from all active plugins.
     */
    'plugin:get-ui-manifest': async (data, ctx) => {
        const { ws } = ctx;
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({
                type: 'plugin:ui-manifest',
                payload: { tabs: [], sidebarSections: [], settingsPanels: [] }
            }));
            return;
        }

        ws.send(JSON.stringify({
            type: 'plugin:ui-manifest',
            payload: pluginManager.getAllUIComponents()
        }));
    },

    /**
     * Get the source code of a plugin UI component.
     */
    'plugin:get-component': async (data, ctx) => {
        const { ws } = ctx;
        // Component source contains plugin code — restrict to localhost
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Component source is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({
                type: 'plugin:component-source',
                payload: { error: 'Plugin system not initialized' }
            }));
            return;
        }

        const { pluginName, componentFile } = data;
        if (!pluginName || !componentFile) {
            ws.send(JSON.stringify({
                type: 'plugin:component-source',
                payload: { error: 'pluginName and componentFile are required' }
            }));
            return;
        }

        const source = await pluginManager.getPluginComponentSource(pluginName, componentFile);
        ws.send(JSON.stringify({
            type: 'plugin:component-source',
            payload: {
                pluginName,
                componentFile,
                source: source || null,
                error: source ? null : 'Component not found'
            }
        }));
    },

    /**
     * Get plugin settings.
     */
    'plugin:get-settings': async (data, ctx) => {
        const { ws } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin settings are only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:settings', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name } = data;
        const plugin = pluginManager.getPlugin(name);
        if (!plugin || !plugin.api) {
            ws.send(JSON.stringify({ type: 'plugin:settings', payload: { name, settings: {} } }));
            return;
        }

        const settings = await plugin.api.settings.getAll();
        ws.send(JSON.stringify({
            type: 'plugin:settings',
            payload: { name, settings }
        }));
    },

    /**
     * Update plugin settings.
     */
    'plugin:set-settings': async (data, ctx) => {
        const { ws } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);
        
        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name, settings } = data;
        const plugin = pluginManager.getPlugin(name);
        if (!plugin || !plugin.api) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: `Plugin '${name}' not active` } }));
            return;
        }

        await plugin.api.settings.setAll(settings);
        ws.send(JSON.stringify({
            type: 'plugin:settings-saved',
            payload: { name, success: true }
        }));
    },

    // ── Install / Uninstall / Update ─────────────────────────────────────

    /**
     * Install a plugin from an npm spec, local path, or git URL.
     * Expects: { spec: string, target?: 'builtin'|'global'|'workspace' }
     */
    'plugin:install': async (data, ctx) => {
        const { ws, broadcast } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);

        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { spec, target } = data;
        if (!spec) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin spec is required' } }));
            return;
        }

        // Stream progress events to the requesting client
        let installer;
        try {
            installer = await getInstaller(pluginManager, ctx);
        } catch (err) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: err.message, spec } }));
            return;
        }

        const progressHandler = (evt) => {
            ws.send(JSON.stringify({ type: 'plugin:install-progress', payload: evt }));
        };
        if (installer.eventBus) {
            installer.eventBus.on('plugin:install-progress', progressHandler);
        }

        try {
            const name = await installer.install(spec, { target });

            // Broadcast updated list
            const plugins = pluginManager.listPlugins();
            broadcast('plugin:list', { plugins });

            ws.send(JSON.stringify({
                type: 'plugin:install-complete',
                payload: { name, spec, success: true }
            }));
        } catch (err) {
            ws.send(JSON.stringify({
                type: 'plugin:error',
                payload: { error: err.message, spec }
            }));
        } finally {
            if (installer.eventBus) {
                installer.eventBus.off('plugin:install-progress', progressHandler);
            }
        }
    },

    /**
     * Uninstall a plugin by name.
     * Expects: { name: string, cleanData?: boolean, target?: string }
     */
    'plugin:uninstall': async (data, ctx) => {
        const { ws, broadcast } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);

        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name, cleanData, target } = data;
        if (!name) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin name is required' } }));
            return;
        }

        try {
            const installer = await getInstaller(pluginManager, ctx);
            await installer.uninstall(name, { cleanData, target });

            const plugins = pluginManager.listPlugins();
            broadcast('plugin:list', { plugins });

            ws.send(JSON.stringify({
                type: 'plugin:uninstalled',
                payload: { name, success: true }
            }));
        } catch (err) {
            ws.send(JSON.stringify({
                type: 'plugin:error',
                payload: { error: err.message, name }
            }));
        }
    },

    /**
     * Update a plugin to its latest version.
     * Expects: { name: string, target?: string }
     */
    'plugin:update': async (data, ctx) => {
        const { ws, broadcast } = ctx;
        if (!isLocalRequest(ctx)) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin management is only available from localhost' } }));
            return;
        }
        const pluginManager = getPluginManager(ctx);

        if (!pluginManager) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin system not initialized' } }));
            return;
        }

        const { name, target } = data;
        if (!name) {
            ws.send(JSON.stringify({ type: 'plugin:error', payload: { error: 'Plugin name is required' } }));
            return;
        }

        try {
            const installer = await getInstaller(pluginManager, ctx);
            await installer.update(name, { target });

            const plugins = pluginManager.listPlugins();
            broadcast('plugin:list', { plugins });

            ws.send(JSON.stringify({
                type: 'plugin:updated',
                payload: { name, success: true }
            }));
        } catch (err) {
            ws.send(JSON.stringify({
                type: 'plugin:error',
                payload: { error: err.message, name }
            }));
        }
    }
};

/**
 * Helper: get or create a PluginInstaller from the PluginManager.
 * @param {object} pluginManager
 * @param {object} ctx
 * @returns {Promise<import('../../plugins/plugin-installer.mjs').PluginInstaller>}
 */
async function getInstaller(pluginManager, ctx) {
    if (typeof pluginManager.getInstaller === 'function') {
        return await pluginManager.getInstaller();
    }
    // Fallback: create one ad-hoc
    const { PluginInstaller } = await import('../../plugins/plugin-installer.mjs');
    return new PluginInstaller({
        workingDir: pluginManager.workingDir,
        pluginManager,
        eventBus: pluginManager._deps?.eventBus || null,
    });
}
