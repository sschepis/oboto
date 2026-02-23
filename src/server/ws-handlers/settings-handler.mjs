import path from 'node:path';
import fs from 'node:fs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { getRegistrySnapshot, fetchRemoteModels, fetchModelsForProvider, listModels } from '../../core/model-registry.mjs';
import { config } from '../../config.mjs';
import { getProjectInfo, getDirectoryTree } from '../ws-helpers.mjs';
import { readJsonFileSync } from '../../lib/json-file-utils.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: get-settings, update-settings, get-status, set-cwd, refresh-models
 */

// ── AI Settings Persistence ─────────────────────────────────────────────

/**
 * Save current AI/routing settings to .ai-man/ai-settings.json in the workspace.
 * @param {string} workingDir
 */
async function persistAISettings(workingDir) {
    if (!workingDir) return;
    try {
        const dir = path.join(workingDir, '.ai-man');
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        const settings = {
            model: config.ai.model,
            provider: config.ai.provider,
            endpoint: config.ai.endpoint,
            temperature: config.ai.temperature,
            routing: { ...config.routing },
            updatedAt: new Date().toISOString()
        };
        await fs.promises.writeFile(
            path.join(dir, 'ai-settings.json'),
            JSON.stringify(settings, null, 2)
        );
    } catch (err) {
        consoleStyler.log('warning', `Failed to persist AI settings: ${err.message}`);
    }
}

/**
 * Restore AI/routing settings from .ai-man/ai-settings.json in a workspace.
 * @param {string} workingDir
 * @param {Object} assistant - The assistant facade
 * @returns {boolean} True if settings were restored
 */
function restoreAISettings(workingDir, assistant) {
    if (!workingDir) return false;
    const settingsPath = path.join(workingDir, '.ai-man', 'ai-settings.json');
    try {
        if (!fs.existsSync(settingsPath)) return false;
        const data = readJsonFileSync(settingsPath);

        if (data.model) {
            config.ai.model = data.model;
            process.env.AI_MODEL = data.model;
            assistant.model = data.model;
        }
        if (data.provider) {
            config.ai.provider = data.provider;
            process.env.AI_PROVIDER = data.provider;
        }
        if (data.endpoint) {
            config.ai.endpoint = data.endpoint;
            process.env.AI_ENDPOINT = data.endpoint;
        }
        if (data.temperature !== undefined) {
            config.ai.temperature = data.temperature;
        }
        if (data.routing && assistant.promptRouter) {
            // Apply explicit routing overrides (empty = follow primary)
            const primaryModel = config.ai.model;
            for (const [role, modelId] of Object.entries(data.routing)) {
                if (modelId && modelId !== primaryModel) {
                    assistant.promptRouter.setRoute(role, modelId);
                } else {
                    assistant.promptRouter.setRoute(role, '');
                }
            }
            Object.assign(config.routing, data.routing);
        }

        consoleStyler.log('system', `⚙️  Restored AI settings from ${settingsPath} (model: ${data.model})`);
        return true;
    } catch (err) {
        consoleStyler.log('warning', `Failed to restore AI settings: ${err.message}`);
        return false;
    }
}

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
        // Auto-enable LMStudio if models were discovered (LMStudio has no API key)
        if (providers.lmstudio && !providers.lmstudio.enabled) {
            const lmstudioModels = listModels({ provider: 'lmstudio' });
            if (lmstudioModels.length > 0) {
                providers.lmstudio = { ...providers.lmstudio, enabled: true };
            }
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
        wsSend(ws, 'settings', buildSettingsPayload(assistant, ctx));
    } catch (err) {
        consoleStyler.log('error', `handleGetSettings failed: ${err.message}`);
        wsSend(ws, 'settings', {
            maxTurns: assistant.maxTurns || 100,
            maxSubagents: assistant.maxSubagents || 1,
            ai: config.ai,
            routing: config.routing,
            modelRegistry: {},
        });
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
        const oldModel = config.ai.model;

        if (provider) {
            process.env.AI_PROVIDER = provider;
            config.ai.provider = provider;
        }
        if (model) {
            process.env.AI_MODEL = model;
            config.ai.model = model;
            // Also update the facade's model property (used for code completion)
            assistant.model = model;

            // When the primary model changes, clear any PromptRouter routes that
            // were set to the OLD primary model so they fall through to the new one.
            // This prevents stale route references from overriding the user's choice.
            if (assistant.promptRouter && oldModel && model !== oldModel) {
                const currentRoutes = assistant.promptRouter.getRoutes();
                for (const [role, routeModel] of Object.entries(currentRoutes)) {
                    if (routeModel === oldModel) {
                        assistant.promptRouter.setRoute(role, '');
                    }
                }
                consoleStyler.log('routing', `Primary model changed: ${oldModel} → ${model}. Cleared default routes.`);
            }
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
            // Distinguish between "use primary model" (empty/same as primary) and explicit overrides.
            // If a route value matches the current primary model, treat it as "default" (clear it)
            // so it dynamically follows future primary model changes.
            const primaryModel = config.ai.model;
            const cleanedRoutes = {};
            for (const [role, modelId] of Object.entries(settings.routing)) {
                if (modelId && modelId !== primaryModel) {
                    cleanedRoutes[role] = modelId; // Explicit override
                } else {
                    cleanedRoutes[role] = ''; // Default — follow primary model
                }
            }
            assistant.promptRouter.setRoutes(cleanedRoutes);
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
    
    wsSend(ws, 'status', 'Settings updated');
    
    // Broadcast new settings back
    wsSend(ws, 'settings', buildSettingsPayload(assistant, ctx));

    // Persist to workspace so settings survive restarts
    persistAISettings(assistant.workingDir);
}

async function handleGetStatus(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const info = await getProjectInfo(assistant.workingDir);
        wsSend(ws, 'status-update', info);
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
                wsSend(ws, 'status-update', info);
                const tree = await getDirectoryTree(resolvedNew, 2);
                wsSend(ws, 'file-tree', tree);
                if (assistant.toolExecutor?.surfaceManager) {
                    try {
                        const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                        wsSend(ws, 'surface-list', surfaces);
                    } catch { wsSend(ws, 'surface-list', []); }
                }
            } catch (e) {
                // Non-fatal — the UI will just show what it has
            }
            return;
        }

        const actualPath = await assistant.changeWorkingDirectory(newPath);

        // Restore AI settings saved for this workspace
        restoreAISettings(actualPath, assistant);

        wsSend(ws, 'status', `Changed working directory to ${actualPath}`);
        
        const info = await getProjectInfo(actualPath);
        wsSend(ws, 'status-update', info);

        const tree = await getDirectoryTree(actualPath, 2);
        wsSend(ws, 'file-tree', tree);

        if (schedulerService) {
            await schedulerService.switchWorkspace(actualPath);
            const schedules = schedulerService.listSchedules();
            broadcast('schedule-list', schedules);
        }

        if (assistant.toolExecutor?.surfaceManager) {
            try {
                const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                wsSend(ws, 'surface-list', surfaces);
            } catch (e) {
                wsSend(ws, 'surface-list', []);
            }
        } else {
            wsSend(ws, 'surface-list', []);
        }

        if (assistant.openClawManager) {
             await assistant.openClawManager.restart(actualPath);
             wsSend(ws, 'openclaw-status', {
                 available: true,
                 connected: assistant.openClawManager.client?.isConnected ?? false,
                 mode: assistant.openClawManager.config.mode,
                 url: assistant.openClawManager.config.url,
                 path: assistant.openClawManager.config.path,
                 authToken: assistant.openClawManager.config.authToken
             });
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to change directory: ${err.message}`);
        wsSendError(ws, err.message);
    }
}

async function handleRefreshModels(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        await fetchRemoteModels();
        broadcast('settings', buildSettingsPayload(assistant, ctx));
    } catch (err) {
        wsSendError(ws, `Failed to refresh models: ${err.message}`);
    }
}

async function handleRefreshProviderModels(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    const provider = data.payload?.provider;
    if (!provider) {
        wsSendError(ws, 'Missing provider in refresh-provider-models request');
        return;
    }

    try {
        await fetchModelsForProvider(provider);
        broadcast('settings', buildSettingsPayload(assistant, ctx));
    } catch (err) {
        wsSendError(ws, `Failed to refresh ${provider} models: ${err.message}`);
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
