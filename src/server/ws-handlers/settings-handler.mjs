import { consoleStyler } from '../../ui/console-styler.mjs';
import { getRegistrySnapshot, fetchRemoteModels } from '../../core/model-registry.mjs';
import { config } from '../../config.mjs';
import { getProjectInfo, getDirectoryTree } from '../ws-helpers.mjs';

/**
 * Handles: get-settings, update-settings, get-status, set-cwd, refresh-models
 */

async function handleGetSettings(data, ctx) {
    const { ws, assistant } = ctx;
    ws.send(JSON.stringify({
        type: 'settings',
        payload: {
            maxTurns: assistant.maxTurns,
            maxSubagents: assistant.maxSubagents,
            ai: config.ai,
            routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
            modelRegistry: getRegistrySnapshot()
        }
    }));
}

async function handleUpdateSettings(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    const settings = data.payload;
    if (settings.maxTurns) assistant.maxTurns = parseInt(settings.maxTurns, 10);
    if (settings.maxSubagents) assistant.maxSubagents = parseInt(settings.maxSubagents, 10);

    // Persist AI provider config to process.env + live config
    if (settings.ai) {
        const { provider, model, endpoint } = settings.ai;
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

        // Trigger model refresh since AI config changed
        fetchRemoteModels().then(() => {
            // Broadcast the updated registry
            const newPayload = {
                maxTurns: assistant.maxTurns,
                maxSubagents: assistant.maxSubagents,
                ai: config.ai,
                routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
                modelRegistry: getRegistrySnapshot()
            };
            broadcast('settings', newPayload);
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
    
    // Broadcast new settings back (include AI config)
    ws.send(JSON.stringify({
        type: 'settings',
        payload: {
            maxTurns: assistant.maxTurns,
            maxSubagents: assistant.maxSubagents,
            ai: config.ai,
            routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
            modelRegistry: getRegistrySnapshot()
        }
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
        const actualPath = await assistant.changeWorkingDirectory(newPath);
        ws.send(JSON.stringify({ type: 'status', payload: `Changed working directory to ${actualPath}` }));
        
        // Push new status update immediately
        const info = await getProjectInfo(actualPath);
        ws.send(JSON.stringify({ type: 'status-update', payload: info }));

        // Push updated file tree for the new workspace
        const tree = await getDirectoryTree(actualPath, 2);
        ws.send(JSON.stringify({ type: 'file-tree', payload: tree }));

        // Switch scheduler to new workspace and restore its schedules
        if (schedulerService) {
            await schedulerService.switchWorkspace(actualPath);
            const schedules = schedulerService.listSchedules();
            broadcast('schedule-list', schedules);
        }

        // Refresh surfaces for the new workspace
        if (assistant.toolExecutor?.surfaceManager) {
            try {
                const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
                ws.send(JSON.stringify({ type: 'surface-list', payload: surfaces }));
            } catch (e) {
                // New workspace may not have a .surfaces/ dir yet — send empty list
                ws.send(JSON.stringify({ type: 'surface-list', payload: [] }));
            }
        } else {
            // No surface manager — send empty list to clear stale state
            ws.send(JSON.stringify({ type: 'surface-list', payload: [] }));
        }

        // Update OpenClaw config for new workspace
        if (assistant.openClawManager) {
             await assistant.openClawManager.restart(actualPath);
             
             // Send updated OpenClaw status
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
        // Broadcast updated settings with new model registry to all clients
        const settingsPayload = {
            maxTurns: assistant.maxTurns,
            maxSubagents: assistant.maxSubagents,
            ai: config.ai,
            routing: assistant.promptRouter ? assistant.promptRouter.getRoutes() : config.routing,
            modelRegistry: getRegistrySnapshot()
        };
        broadcast('settings', settingsPayload);
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', payload: `Failed to refresh models: ${err.message}` }));
    }
}

export const handlers = {
    'get-settings': handleGetSettings,
    'update-settings': handleUpdateSettings,
    'get-status': handleGetStatus,
    'set-cwd': handleSetCwd,
    'refresh-models': handleRefreshModels
};
