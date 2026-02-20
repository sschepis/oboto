/**
 * WebSocket handler for workspace management.
 *
 * Supports:
 *   - workspace:switch   – switch the server to a new workspace directory
 *   - workspace:status   – request current workspace status
 *   - service:status     – request full service health report
 */

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { SecretsManager } from '../secrets-manager.mjs';

/**
 * Switch the active workspace.  Re-initialises assistant, scheduler, and
 * agent-loop controller against the new directory.
 *
 * @param {object} data  – WS message payload  { path: string }
 * @param {object} ctx   – dispatcher context
 */
async function handleWorkspaceSwitch(data, ctx) {
    const { ws, assistant, broadcast, schedulerService, agentLoopController, secretsManager, workspaceContentServer } = ctx;
    const newPath = data.path;

    if (!newPath || typeof newPath !== 'string') {
        ws.send(JSON.stringify({
            type: 'workspace:switched',
            payload: { success: false, error: 'Missing or invalid path' }
        }));
        return;
    }

    const resolved = path.resolve(newPath);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        ws.send(JSON.stringify({
            type: 'workspace:switched',
            payload: { success: false, error: `Directory does not exist: ${resolved}` }
        }));
        return;
    }

    try {
        consoleStyler.log('system', `🔄 Switching workspace to: ${resolved}`);

        // 1. Stop agent loop (if playing)
        if (agentLoopController) {
            agentLoopController.stop();
        }

        // 2. Switch scheduler workspace (persists old, loads new)
        if (schedulerService) {
            await schedulerService.switchWorkspace(resolved);
        }

        // 3. Reload secrets from the new workspace
        if (secretsManager) {
            // SecretsManager stores its vault relative to workingDir
            const newSecrets = new SecretsManager(resolved);
            await newSecrets.load();
            newSecrets.applyToEnv();
        }

        // 4. Reinitialise the assistant against the new working dir
        assistant.workingDir = resolved;
        if (assistant.conversationManager) {
            // ConversationManager stores conversations under workingDir
            assistant.conversationManager.workingDir = resolved;
        }
        await assistant.loadConversation();

        // 5. Restart workspace content server
        if (workspaceContentServer) {
            try {
                await workspaceContentServer.start(resolved);
                // Broadcast new port to all clients
                broadcast('workspace:server-info', { port: workspaceContentServer.getPort() });
            } catch (e) {
                consoleStyler.log('error', `Failed to restart workspace content server: ${e.message}`);
            }
        }

        // 6. Auto-activate agent loop if env says so
        if (process.env.OBOTO_AUTO_ACTIVATE === 'true' && agentLoopController) {
            agentLoopController.play();
        }

        consoleStyler.log('system', `✅ Workspace switched to: ${resolved}`);

        // Notify requesting client
        ws.send(JSON.stringify({
            type: 'workspace:switched',
            payload: { success: true, path: resolved }
        }));

        // Broadcast status to all clients
        broadcastWorkspaceStatus(ctx);

    } catch (err) {
        consoleStyler.log('error', `Failed to switch workspace: ${err.message}`);
        ws.send(JSON.stringify({
            type: 'workspace:switched',
            payload: { success: false, error: err.message }
        }));
    }
}

/**
 * Return current workspace status to the requesting client.
 */
function handleWorkspaceStatus(_data, ctx) {
    const { ws } = ctx;
    const status = buildWorkspaceStatus(ctx);
    ws.send(JSON.stringify({ type: 'workspace:status', payload: status }));
}

/**
 * Return full service health report.
 */
function handleServiceStatus(_data, ctx) {
    const { ws, assistant, schedulerService, agentLoopController } = ctx;

    const payload = {
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        workspace: assistant?.workingDir || process.cwd(),
        agentLoop: agentLoopController ? agentLoopController.getState() : null,
        schedules: schedulerService ? schedulerService.listSchedules('all').length : 0,
        schedulesActive: schedulerService ? schedulerService.listSchedules('active').length : 0,
    };

    ws.send(JSON.stringify({ type: 'service:status-response', payload }));
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildWorkspaceStatus(ctx) {
    const { assistant, schedulerService, agentLoopController } = ctx;
    return {
        path: assistant?.workingDir || process.cwd(),
        active: true,
        agentLoopState: agentLoopController ? agentLoopController.getState().state : 'unknown',
        schedules: schedulerService ? schedulerService.listSchedules('all').length : 0,
        schedulesActive: schedulerService ? schedulerService.listSchedules('active').length : 0,
    };
}

function broadcastWorkspaceStatus(ctx) {
    const { broadcast } = ctx;
    const status = buildWorkspaceStatus(ctx);
    broadcast('workspace:status', status);
}

// ── Export handler map ───────────────────────────────────────────────────

export const handlers = {
    'workspace:switch': handleWorkspaceSwitch,
    'workspace:status': handleWorkspaceStatus,
    'service:status': handleServiceStatus,
};
