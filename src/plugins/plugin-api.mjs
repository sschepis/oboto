/**
 * PluginAPI — the controlled API surface exposed to plugins.
 * 
 * Each plugin receives its own PluginAPI instance that provides
 * scoped access to tools, events, WS handlers, surfaces, settings, 
 * storage, AI, and UI registration.
 * 
 * The PluginManager creates a PluginAPI per plugin via createPluginAPI().
 * 
 * @module src/plugins/plugin-api
 */

import { PluginStorage } from './plugin-storage.mjs';
import { PluginSettingsStore } from './plugin-settings.mjs';

/**
 * Tools that non-builtin plugins are forbidden from invoking via `tools.execute()`.
 * These allow arbitrary code execution, shell access, or OS-level automation.
 * @const {Set<string>}
 */
const RESTRICTED_TOOLS = new Set([
    'run_command', 'execute_javascript', 'execute_npm_function',
    'call_ai_assistant', 'spawn_background_task',
    'mouse_move', 'mouse_click', 'keyboard_type', 'keyboard_press',
    'screen_capture'
]);

/**
 * Create a scoped PluginAPI for a specific plugin.
 * 
 * @param {string} pluginName — the plugin's unique name
 * @param {object} deps — shared system dependencies
 * @param {object} deps.toolExecutor — ToolExecutor instance
 * @param {object} deps.wsDispatcher — WsDispatcher instance
 * @param {object} deps.eventBus — EventBus instance
 * @param {object} [deps.surfaceManager] — SurfaceManager instance (optional)
 * @param {object} [deps.aiProvider] — EventicAIProvider instance (optional)
 * @param {string} deps.workingDir — workspace root
 * @param {object} deps.pluginManager — PluginManager instance (for cross-plugin queries)
 * @returns {PluginAPI}
 */
export function createPluginAPI(pluginName, deps, options = {}) {
    const { source = 'unknown' } = options;
    const {
        toolExecutor,
        wsDispatcher,
        eventBus,
        surfaceManager,
        aiProvider,
        workingDir,
        pluginManager
    } = deps;

    // Track registrations so we can clean up on deactivate
    const registeredTools = new Set();
    const registeredWsHandlers = new Set();
    const registeredEventListeners = [];
    const registeredMiddleware = [];
    const registeredUIComponents = {
        tabs: [],
        sidebarSections: [],
        settingsPanels: []
    };

    // Scoped storage & settings
    const storage = new PluginStorage(pluginName, workingDir);
    const settings = new PluginSettingsStore(pluginName, workingDir);

    // ── Tools API ────────────────────────────────────────────────────────

    const toolsAPI = {
        /**
         * Register a tool that the AI can invoke.
         * @param {object} def
         * @param {string} def.name — tool name (will be prefixed with plugin name)
         * @param {string} def.description — tool description for the AI
         * @param {object} def.parameters — JSON Schema for parameters
         * @param {Function} def.handler — async handler function
         * @param {boolean} [def.surfaceSafe=false] — if true, tool can be called from surface context
         */
        register(def) {
            // Only builtin plugins may use useOriginalName
            const canUseOriginalName = def.useOriginalName && source === 'builtin';
            const fullName = canUseOriginalName ? def.name : `plugin_${pluginName}_${def.name}`;
            const schema = {
                type: 'function',
                function: {
                    name: fullName,
                    description: canUseOriginalName
                        ? def.description
                        : `[Plugin: ${pluginName}] ${def.description}`,
                    parameters: def.parameters || { type: 'object', properties: {} }
                }
            };

            // Register handler on ToolExecutor via its public API
            if (toolExecutor) {
                toolExecutor.registerPluginTool(fullName, def.handler, schema, {
                    surfaceSafe: !!def.surfaceSafe
                });
            }

            registeredTools.add(fullName);

            // Emit event so UI can refresh tool list
            if (eventBus) {
                eventBus.emit('plugin:tool-registered', { pluginName, toolName: fullName });
            }

            return fullName;
        },

        /**
         * Unregister a previously registered tool.
         * @param {string} name — original (short) name
         */
        unregister(name) {
            // Try both prefixed and unprefixed names
            const prefixedName = `plugin_${pluginName}_${name}`;
            const nameToRemove = registeredTools.has(name) ? name : prefixedName;
            if (toolExecutor) {
                toolExecutor.unregisterPluginTool(nameToRemove);
            }
            registeredTools.delete(nameToRemove);
        },

        /**
         * Execute a tool by name (including plugin-registered tools).
         * @param {string} name — full tool name
         * @param {object} args
         * @returns {Promise<unknown>}
         */
        async execute(name, args) {
            if (!toolExecutor) throw new Error(`Tool not found: ${name}`);

            // Restrict non-builtin plugins from executing dangerous core tools
            if (source !== 'builtin') {
                if (RESTRICTED_TOOLS.has(name)) {
                    throw new Error(
                        `Plugin "${pluginName}" is not authorized to execute restricted tool "${name}". ` +
                        `Only builtin plugins may invoke this tool.`
                    );
                }
            }

            const toolCall = {
                id: `plugin-${pluginName}-${Date.now()}`,
                function: { name, arguments: JSON.stringify(args) }
            };
            const result = await toolExecutor.executeTool(toolCall);
            return result?.content ?? '';
        },

        /**
         * List all registered tools.
         * @returns {string[]}
         */
        list() {
            return Array.from(registeredTools);
        }
    };

    // ── WebSocket API ────────────────────────────────────────────────────

    const wsAPI = {
        /**
         * Register a handler for a new WebSocket message type.
         * @param {string} type — message type (will be prefixed)
         * @param {Function} handler — async (data, ctx) => void
         */
        register(type, handler) {
            const fullType = `plugin:${pluginName}:${type}`;
            if (wsDispatcher) {
                wsDispatcher.register(fullType, handler);
            }
            registeredWsHandlers.add(fullType);
            return fullType;
        },

        /**
         * Broadcast a message to all connected WebSocket clients.
         * @param {string} type — message type
         * @param {unknown} payload
         */
        broadcast(type, payload) {
            const fullType = `plugin:${pluginName}:${type}`;
            if (deps._broadcast) {
                deps._broadcast(fullType, payload);
            }
        },

        /**
         * List registered WS handler types.
         * @returns {string[]}
         */
        list() {
            return Array.from(registeredWsHandlers);
        }
    };

    // Allowlist of system events that non-builtin plugins may listen to
    const ALLOWED_SYSTEM_EVENTS = new Set([
        'agent-loop:step',
        'tool:executed',
        'notification:send',
        'dsn:observation',
        'workspace:changed',
        'plugin:activated',
        'plugin:deactivated',
        'plugin:ui-changed',
        'plugin:tool-registered',
    ]);

    // ── Events API ───────────────────────────────────────────────────────

    const eventsAPI = {
        /**
         * Listen for an event scoped to this plugin's namespace.
         * The event name is automatically prefixed with `plugin:<pluginName>:`.
         * @param {string} event
         * @param {Function} handler
         */
        on(event, handler) {
            if (eventBus) {
                const fullEvent = `plugin:${pluginName}:${event}`;
                eventBus.on(fullEvent, handler);
                registeredEventListeners.push({ event: fullEvent, handler });
            }
        },

        /**
         * Remove a scoped event listener.
         * @param {string} event
         * @param {Function} handler
         */
        off(event, handler) {
            if (eventBus) {
                const fullEvent = `plugin:${pluginName}:${event}`;
                eventBus.off(fullEvent, handler);
                const idx = registeredEventListeners.findIndex(
                    l => l.event === fullEvent && l.handler === handler
                );
                if (idx >= 0) registeredEventListeners.splice(idx, 1);
            }
        },

        /**
         * Emit an event (scoped to plugin namespace).
         * The event name is automatically prefixed with `plugin:<pluginName>:`.
         * @param {string} event
         * @param {unknown} data
         */
        emit(event, data) {
            const fullEvent = `plugin:${pluginName}:${event}`;
            if (eventBus) {
                eventBus.emit(fullEvent, data);
            }
        },

        /**
         * Listen for a system-level event (not namespaced).
         * Use this to react to core system events like 'workspace:changed'.
         * @param {string} event — full event name
         * @param {Function} handler
         */
        onSystem(event, handler) {
            if (source !== 'builtin' && !ALLOWED_SYSTEM_EVENTS.has(event)) {
                console.warn(`[PluginAPI:${pluginName}] Denied access to system event "${event}" — only builtin plugins may listen to this event`);
                return;
            }
            if (eventBus) {
                eventBus.on(event, handler);
                registeredEventListeners.push({ event, handler });
            }
        },

        /**
         * Listen once for a scoped event.
         * @param {string} event
         * @param {Function} handler
         */
        once(event, handler) {
            if (eventBus) {
                const fullEvent = `plugin:${pluginName}:${event}`;
                eventBus.once(fullEvent, handler);
                registeredEventListeners.push({ event: fullEvent, handler, once: true });
            }
        }
    };

    // ── Middleware API ────────────────────────────────────────────────────

    const middlewareAPI = {
        /**
         * Add middleware that runs before tool execution.
         *
         * @experimental Middleware hooks are registered but not yet invoked by the
         * tool execution pipeline. This API is reserved for future use.
         *
         * @param {string} hook — e.g. 'before:tool-execute', 'after:tool-execute', 'before:ai-request'
         * @param {Function} fn — async (context, next) => result
         */
        use(hook, fn) {
            const entry = { pluginName, hook, fn };
            registeredMiddleware.push(entry);
            if (pluginManager) {
                pluginManager._registerMiddleware(entry);
            }
        }
    };

    // ── Surfaces API ─────────────────────────────────────────────────────

    const surfacesAPI = {
        /**
         * Create a new surface.
         * @param {string} name
         * @param {string} description
         * @param {string} [layout='vertical']
         * @returns {Promise<object>}
         */
        async create(name, description, layout = 'vertical') {
            if (!surfaceManager) throw new Error('SurfaceManager not available');
            return await surfaceManager.createSurface(name, description, layout);
        },

        /**
         * Update a component on a surface.
         * @param {string} surfaceId
         * @param {string} componentName
         * @param {string} jsxSource
         * @param {object} [props]
         * @param {number} [order]
         * @returns {Promise<object>}
         */
        async updateComponent(surfaceId, componentName, jsxSource, props = {}, order = null) {
            if (!surfaceManager) throw new Error('SurfaceManager not available');
            return await surfaceManager.updateComponent(surfaceId, componentName, jsxSource, props, order);
        },

        /**
         * Delete a surface.
         * @param {string} surfaceId
         * @returns {Promise<boolean>}
         */
        async delete(surfaceId) {
            if (!surfaceManager) throw new Error('SurfaceManager not available');
            return await surfaceManager.deleteSurface(surfaceId);
        },

        /**
         * List all surfaces.
         * @returns {Promise<Array>}
         */
        async list() {
            if (!surfaceManager) return [];
            return await surfaceManager.listSurfaces();
        }
    };

    // ── AI API ───────────────────────────────────────────────────────────

    const aiAPI = {
        /**
         * Ask the configured LLM a question.
         * @param {string} prompt
         * @param {object} [options]
         * @returns {Promise<string>}
         */
        async ask(prompt, options = {}) {
            if (!aiProvider) throw new Error('AI provider not available');
            const result = await aiProvider.ask(prompt, {
                ...options,
                recordHistory: false // Plugin queries don't pollute main history
            });
            return typeof result === 'string' ? result : (result.content || '');
        },

        /**
         * Stream a response from the LLM.
         * @param {string} prompt
         * @param {Function} onChunk — called with each chunk
         * @param {object} [options]
         * @returns {Promise<string>} full response
         */
        async stream(prompt, onChunk, options = {}) {
            if (!aiProvider) throw new Error('AI provider not available');
            return await aiProvider.askStream(prompt, onChunk, {
                ...options,
                recordHistory: false
            });
        }
    };

    // ── UI API ───────────────────────────────────────────────────────────

    const uiAPI = {
        /**
         * Register a tab that appears in the UI tab bar.
         * @param {object} tab
         * @param {string} tab.id
         * @param {string} tab.label
         * @param {string} [tab.icon]
         * @param {string} tab.component — JSX source file path relative to plugin dir
         */
        registerTab(tab) {
            const fullTab = {
                ...tab,
                id: `plugin:${pluginName}:${tab.id}`,
                pluginName,
                type: 'plugin-tab'
            };
            registeredUIComponents.tabs.push(fullTab);
            if (eventBus) {
                eventBus.emit('plugin:ui-changed', { pluginName });
            }
        },

        /**
         * Register a sidebar section.
         * @param {object} section
         * @param {string} section.id
         * @param {string} section.label
         * @param {string} section.component — JSX source file path
         * @param {number} [section.order=100]
         */
        registerSidebarSection(section) {
            const fullSection = {
                ...section,
                id: `plugin:${pluginName}:${section.id}`,
                pluginName,
                type: 'plugin-sidebar'
            };
            registeredUIComponents.sidebarSections.push(fullSection);
            if (eventBus) {
                eventBus.emit('plugin:ui-changed', { pluginName });
            }
        },

        /**
         * Register a settings panel that appears in the Settings dialog.
         * @param {object} panel
         * @param {string} panel.id
         * @param {string} panel.label
         * @param {string} panel.component — JSX source file path
         */
        registerSettingsPanel(panel) {
            const fullPanel = {
                ...panel,
                id: `plugin:${pluginName}:${panel.id}`,
                pluginName,
                type: 'plugin-settings'
            };
            registeredUIComponents.settingsPanels.push(fullPanel);
            if (eventBus) {
                eventBus.emit('plugin:ui-changed', { pluginName });
            }
        },

        /**
         * Get all registered UI components for this plugin.
         * @returns {object}
         */
        getRegistered() {
            return { ...registeredUIComponents };
        }
    };

    // ── Services API (builtin only) ─────────────────────────────────────
    // Provides controlled access to core system services.
    // Only available to builtin plugins to prevent third-party plugins from
    // reaching into core internals.
    //
    // The returned object is frozen to prevent plugins from accidentally
    // replacing service references. Individual services are still mutable
    // objects (by design — plugins need to call methods on them), but the
    // API surface itself cannot be monkey-patched.
    const servicesAPI = source === 'builtin' ? Object.freeze({
        get assistant() { return deps.pluginManager?._deps?.assistant ?? deps.assistant ?? null; },
        get surfaceManager() { return deps.surfaceManager ?? deps.pluginManager?._deps?.surfaceManager ?? null; },
        get secretsManager() { return deps.pluginManager?._deps?.secretsManager ?? null; },
        get workingDir() { return workingDir; },
    }) : undefined;

    // ── Cleanup ──────────────────────────────────────────────────────────

    /**
     * Clean up all registrations made by this plugin.
     * Called by PluginManager when deactivating a plugin.
     */
    async function cleanup() {
        // Remove tools via ToolExecutor's public API
        for (const toolName of registeredTools) {
            if (toolExecutor) {
                toolExecutor.unregisterPluginTool(toolName);
            }
        }
        registeredTools.clear();

        // Remove WS handlers
        for (const type of registeredWsHandlers) {
            if (wsDispatcher?.unregister) {
                wsDispatcher.unregister(type);
            }
        }
        registeredWsHandlers.clear();

        // Remove event listeners
        for (const { event, handler } of registeredEventListeners) {
            if (eventBus) {
                eventBus.off(event, handler);
            }
        }
        registeredEventListeners.length = 0;

        // Remove middleware
        for (const entry of registeredMiddleware) {
            if (pluginManager) {
                pluginManager._unregisterMiddleware(entry);
            }
        }
        registeredMiddleware.length = 0;

        // Clear UI registrations
        registeredUIComponents.tabs.length = 0;
        registeredUIComponents.sidebarSections.length = 0;
        registeredUIComponents.settingsPanels.length = 0;

        // Flush storage
        await storage.flush();
    }

    /**
     * The public PluginAPI object returned to each plugin's `activate(api)`.
     *
     * ## Instance State Pattern (`api._pluginInstance`)
     *
     * Plugins that hold mutable state across their lifecycle **should** store
     * it on `api._pluginInstance` rather than in module-level `let` variables.
     *
     * **Why:** The plugin loader uses ESM cache-busting (`?t=<timestamp>`) to
     * support hot-reload. Each reload creates a fresh module scope, but the
     * old module entry may linger in the V8 module cache. Module-level `let`
     * variables in the old scope become orphaned — they can't be reset by
     * `deactivate()` since it runs in the *new* scope.
     *
     * **How:**
     * ```js
     * // In activate(api):
     * const state = { counter: 0, cache: new Map() };
     * api._pluginInstance = state;
     *
     * api.tools.register({
     *   name: 'increment',
     *   handler: () => { state.counter++; return state.counter; }
     * });
     *
     * // In deactivate(api):
     * if (api._pluginInstance) {
     *   api._pluginInstance.cache.clear();
     *   api._pluginInstance = null;
     * }
     * ```
     *
     * @type {PluginAPI}
     */
    /** @type {*} Internal slot for plugin instance state */
    let _instanceState = null;

    return {
        tools: toolsAPI,
        ws: wsAPI,
        events: eventsAPI,
        middleware: middlewareAPI,
        surfaces: surfacesAPI,
        settings,
        storage,
        ai: aiAPI,
        ui: uiAPI,
        services: servicesAPI,
        workingDir,

        /**
         * Store plugin instance state.
         * Preferred over module-level `let` variables to survive ESM reloads.
         * @param {*} state — any serializable or object state
         */
        setInstance(state) {
            _instanceState = state;
        },

        /**
         * Retrieve previously stored plugin instance state.
         * @returns {*}
         */
        getInstance() {
            return _instanceState;
        },

        /**
         * Legacy property accessor for plugin instance state.
         * Kept for backward compatibility — prefer setInstance()/getInstance().
         * @type {*}
         */
        get _pluginInstance() {
            return _instanceState;
        },
        set _pluginInstance(value) {
            _instanceState = value;
        },

        _cleanup: cleanup,
        _registeredUIComponents: registeredUIComponents
    };
}
