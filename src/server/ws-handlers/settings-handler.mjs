import path from 'node:path';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { getRegistrySnapshot, fetchRemoteModels, fetchModelsForProvider } from '../../core/model-registry.mjs';
import { config } from '../../config.mjs';
import { getProjectInfo, getDirectoryTree } from '../ws-helpers.mjs';

/**
 * Handles: get-settings, update-settings, get-status, set-cwd, refresh-models
 */

/**
 * Build the canonical settings payload for sending to the UI.
 * Wrapped in try/catch — always returns a valid payload even on error.
 */
function buildSettingsPayload(assistant, ctx) {
    try {
        // Build secrets status map for API key display in UI
        const secretsStatus = {};
        if (ctx && ctx.secretsManager) {
            try {
                const secretsList = ctx.secretsManager.list();
                for (const s of secretsList) {
                    if (s && s.name) {
                        secretsStatus[s.name] = { isConfigured: !!s.isConfigured, source: s.source || 'none' };
                    }
                }
            } catch (e) {
                consoleStyler.log('warning', `Failed to list secrets for settings: ${e.message}`);
            }
        }

        // Build providers map with auto-detection from live API keys
        const providers = {};
        if (config.ai.providers) {
            for (const [key, val] of Object.entries(config.ai.providers)) {
                providers[key] = { ...val };
            }
        }
        // Auto-enable providers that have API keys configured
        if (secretsStatus.OPENAI_API_KEY?.isConfigured && providers.openai && !providers.openai.enabled) {
            providers.openai = { ...providers.openai, enabled: true };
        }
        if (secretsStatus.GOOGLE_API_KEY?.isConfigured && providers.gemini && !providers.gemini.enabled) {
            providers.gemini = { ...providers.gemini, enabled: true };
        }
        if (secretsStatus.ANTHROPIC_API_KEY?.isConfigured && providers.anthropic && !providers.anthropic.enabled) {
            providers.anthropic = { ...providers.anthropic, enabled: true };
        }

        // Build routing with defaults
        let routing = {};
        try {
            routing = assistant.promptRouter ? assistant.promptRouter.getRoutes() : { ...config.routing };
        } catch (e) {
            routing = { ...config.routing };
        }
        const primaryModel = config.ai.model || '';
        for (const role of ['agentic', 'reasoning_high', 'reasoning_medium', 'reasoning_low', 'summarizer', 'code_completion']) {
            if (!routing[role]) {
                routing[role] = primaryModel;
            }
        }

        return {
            maxTurns: assistant.maxTurns,
            maxSubagents: assistant.maxSubagents,
            ai: { ...config.ai, providers },
            routing,
            modelRegistry: getRegistrySnapshot(),
            secretsStatus,
        };
    } catch (err) {
        // Fallback — always return a valid payload
        consoleStyler.log('warning', `buildSettingsPayload error: ${err.message}`);
        return {
            maxTurns: assistant.maxTurns || 100,
            maxSubagents: assistant.maxSubagents || 1,
            ai: config.ai,
            routing: config.routing,
            modelRegistry: getRegistrySnapshot(),
            secretsStatus: {},
        };
    }
}

async function handleGetSettings(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        ws.send(JSON.stringify({
            type: 'settings',
            payload: buildSettingsPayload(assistant, ctx)
        }));
    } catch (err) {
        consoleStyler.log('error', `handleGetSettings failed: ${err.message}`);
        // Send minimal valid settings so UI doesn't hang
        ws.send(JSON.stringify({
            type: 'settings',
            payload: {
                maxTurns: assistant.maxTurns || 100,
                maxSubagents: assistant.maxSubagents || 1,
                ai: config.ai,
                routing: config.routing,
                modelRegistry: {},
            }
        }));
    }
}

async function handleUpdateSettings(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    const settings = data.payload;
    if (settings.maxTurns) assistant.maxTurns = parseInt(settings.maxTurns, 10);
    if (settings.maxSubagents) assistant.maxSubagents = parseInt(settings.maxSubagents, 10);

    // Persist AI provider config to process.env + live config
    if (settings.ai) {
        const { provider, model, endpoint, providers } = settings.ai;
        if (provider) {
            process.env.AI_PROVIDER = provider;
            config.ai.provider = provider;
        }
        if (model) {
            process.env.AI_MODEL = model;
            config.ai.model = model;
        }
        if (endpoint) {
            process.env.AI_ENDPOINT = endpoint;
            config.ai.endpoint = endpoint;
        }

        // Persist per-provider configuration
        if (providers && typeof providers === 'object') {
            for (const [prov, pCfg] of Object.entries(providers)) {
                if (config.ai.providers && config.ai.providers[prov]) {
                    config.ai.providers[prov] = { ...config.ai.providers[prov], ...pCfg };
                }
            }
        }

        // Trigger model refresh since AI config changed
        fetchRemoteModels().then(() => {
            try {
                broadcast('settings', buildSettingsPayload(assistant, ctx));
            } catch (e) {
                consoleStyler.log('warning', `Failed to broadcast settings after model refresh: ${e.message}`);
            }
        }).catch(err => {
            consoleStyler.log('warning', `Failed to refresh models after settings update: ${err.message}`);
        });
    }

    // Update routing configuration
    if (settings.routing) {
        if (assistant.promptRouter) {
            assistant.promptRouter.setRoutes(settings.routing);
        }
        // Update config and env vars for persistence
        Object.assign(config.routing, settings.routing);
        
        if (settings.routing.agentic) process.env.ROUTE_AGENTIC = settings.routing.agentic;
        if (settings.routing.reasoning_high) process.env.ROUTE_REASONING_HIGH = settings.routing.reasoning_high;
        if (settings.routing.reasoning_medium) process.env.ROUTE_REASONING_MEDIUM = settings.routing.reasoning_medium;
        if (settings.routing.reasoning_low) process.env.ROUTE_REASONING_LOW = settings.routing.reasoning_low;
        if (settings.routing.summarizer) process.env.ROUTE_SUMMARIZER = settings.routing.summarizer;
        if (settings.routing.code_completion) process.env.ROUTE_CODE_COMPLETION = settings.routing.code_completion;
    }
    
    ws.send(JSON.stringify({
        type: 'status',
        payload: 'Settings updated'
    }));
    
    // Broadcast new settings back
    ws.send(JSON.stringify({
        type: 'settings',
        payload: buildSettingsPayload(assistant, ctx)
    }));
}

async function handleGetStatus(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const info = await getProjectInfo(assistant.workingDir);
        ws.send(JSON.stringify({ type: 'status-update', payload: info }));
    } catch (err) {
        consoleStyler.log('error', `Failed to get project info: ${err.message}`);
    }
}

async function handleSetCwd(data, ctx) {
    const { ws, assistant, broadcast, schedulerService } = ctx;
    try {
        const newPath = data.payload;

        const resolvedNew = path.resolve(newPath);
        if (assistant.workingDir && path.resolve(assistant.workingDir) === resolvedNew) {
            consoleStyler.log('system', `set-cwd skipped — already in ${resolvedNew}`);
            // Still send back status, file tree, and surfaces so the UI isn't left hanging
            // (happens on browser reload when localStorage has the saved CWD)
            try {
                const info = await getProjectInfo(resolvedNew);
                ws.send(JSON.stringify({ type: 'status-update', payload: info }));
                const tree = await getDirectoryTree(resolvedNew, 2);
                ws.send(JSON.stringify({ type: 'file-tree', payload: tree }));
                // Send surfaces for this workspace
                if (assistant.toolExecutor?.surfaceManager) {
                    try {
                        const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                        ws.send(JSON.stringify({ type: 'surface-list', payload: surfaces }));
                    } catch { ws.send(JSON.stringify({ type: 'surface-list', payload: [] })); }
                }
            } catch (e) {
                // Non-fatal — the UI will just show what it has
            }
            return;
        }

        const actualPath = await assistant.changeWorkingDirectory(newPath);
        ws.send(JSON.stringify({ type: 'status', payload: `Changed working directory to ${actualPath}` }));
        
        const info = await getProjectInfo(actualPath);
        ws.send(JSON.stringify({ type: 'status-update', payload: info }));

        const tree = await getDirectoryTree(actualPath, 2);
        ws.send(JSON.stringify({ type: 'file-tree', payload: tree }));

        if (schedulerService) {
            await schedulerService.switchWorkspace(actualPath);
            const schedules = schedulerService.listSchedules();
            broadcast('schedule-list', schedules);
        }

        if (assistant.toolExecutor?.surfaceManager) {
            try {
                const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                ws.send(JSON.stringify({ type: 'surface-list', payload: surfaces }));
            } catch (e) {
                ws.send(JSON.stringify({ type: 'surface-list', payload: [] }));
            }
        } else {
            ws.send(JSON.stringify({ type: 'surface-list', payload: [] }));
        }

        if (assistant.openClawManager) {
             await assistant.openClawManager.restart(actualPath);
             ws.send(JSON.stringify({
                type: 'openclaw-status',
                payload: {
                    available: true,
                    connected: assistant.openClawManager.client?.isConnected ?? false,
                    mode: assistant.openClawManager.config.mode,
                    url: assistant.openClawManager.config.url,
                    path: assistant.openClawManager.config.path,
                    authToken: assistant.openClawManager.config.authToken
                }
             }));
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to change directory: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', payload: err.message }));
    }
}

async function handleRefreshModels(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        await fetchRemoteModels();
        broadcast('settings', buildSettingsPayload(assistant, ctx));
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to refresh models: ${err.message}` }));
    }
}

async function handleRefreshProviderModels(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    const provider = data.payload?.provider;
    if (!provider) {
        ws.send(JSON.stringify({ type: 'error', payload: 'Missing provider in refresh-provider-models request' }));
        return;
    }

    try {
        await fetchModelsForProvider(provider);
        broadcast('settings', buildSettingsPayload(assistant, ctx));
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to refresh ${provider} models: ${err.message}` }));
    }
}

export const handlers = {
    'get-settings': handleGetSettings,
    'update-settings': handleUpdateSettings,
    'get-status': handleGetStatus,
    'set-cwd': handleSetCwd,
    'refresh-models': handleRefreshModels,
    'refresh-provider-models': handleRefreshProviderModels
};
