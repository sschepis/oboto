import os from 'os';
import path from 'path';
import fs from 'fs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';
import { readJsonFileSync } from '../../lib/json-file-utils.mjs';

/**
 * Handles: openclaw-status, openclaw-config, openclaw-deploy, 
 * openclaw-check-prereqs, openclaw-install
 */

/** Build the common openclaw status payload from a manager instance */
function buildClawStatus(manager) {
    return {
        available: !!manager,
        connected: manager?.client?.isConnected ?? false,
        mode: manager?.config?.mode ?? null,
        url: manager?.config?.url ?? null,
        path: manager?.config?.path ?? null,
        authToken: manager?.config?.authToken ?? null
    };
}

function sendClawStatus(ws, manager) {
    wsSend(ws, 'openclaw-status', buildClawStatus(manager));
}

async function handleOpenClawStatus(data, ctx) {
    const { ws, assistant } = ctx;
    sendClawStatus(ws, assistant?.openClawManager);
}

async function handleOpenClawConfig(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    if (manager) {
        try {
            const { restart, scope, ...config } = data.payload;
            await manager.setConfig(config, scope, assistant.workingDir);
            if (restart) await manager.restart(assistant.workingDir);
            sendClawStatus(ws, manager);
            wsSend(ws, 'status', 'OpenClaw configuration updated');
        } catch (err) {
            wsSendError(ws, `Failed to update OpenClaw config: ${err.message}`);
        }
    } else {
        wsSendError(ws, 'OpenClaw Manager not available');
    }
}

async function handleOpenClawDeploy(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    if (manager) {
        try {
            if (data.payload) manager.setConfig(data.payload);
            
            wsSend(ws, 'status', 'Installing OpenClaw...');
            await manager.install();

            wsSend(ws, 'status', 'Deploying OpenClaw...');
            manager.setConfig({ mode: 'integrated' });
            await manager.restart();
            
            sendClawStatus(ws, manager);
            wsSend(ws, 'status', 'OpenClaw deployed');
        } catch (err) {
            wsSendError(ws, `Failed to deploy OpenClaw: ${err.message}`);
        }
    } else {
        wsSendError(ws, 'OpenClaw Manager not available');
    }
}

async function handleCheckPrereqs(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    
    if (!manager) {
        wsSendError(ws, 'OpenClaw Manager not available');
        return;
    }

    try {
        const prereqs = await manager.checkPrerequisites();
        
        const COMMON_OPENCLAW_PATHS = [
            path.join(os.homedir(), '.openclaw-gateway'),
            path.join(os.homedir(), 'openclaw'),
            path.join(os.homedir(), 'Development', 'openclaw'),
            path.join(os.homedir(), 'Projects', 'openclaw'),
            '/opt/openclaw',
            '/usr/local/openclaw',
        ];
        
        if (manager.config.path) COMMON_OPENCLAW_PATHS.unshift(manager.config.path);
        if (process.env.OPENCLAW_PATH) COMMON_OPENCLAW_PATHS.unshift(process.env.OPENCLAW_PATH);

        let existingInstall = null;
        for (const candidate of COMMON_OPENCLAW_PATHS) {
            if (!path.isAbsolute(candidate)) continue;
            
            if (fs.existsSync(path.join(candidate, 'openclaw.mjs'))) {
                const pkg = readJsonFileSync(path.join(candidate, 'package.json'), null);
                if (pkg?.name === '@sschepis/openclaw') {
                    existingInstall = {
                        found: true,
                        path: candidate,
                        version: pkg.version,
                        isBuilt: fs.existsSync(path.join(candidate, 'dist', 'index.js')),
                        hasNodeModules: fs.existsSync(path.join(candidate, 'node_modules'))
                    };
                    break;
                }
            }
        }
        if (!existingInstall) existingInstall = { found: false };

        let defaultPath = path.join(os.homedir(), '.openclaw-gateway');
        const devDir = path.join(os.homedir(), 'Development');
        if (fs.existsSync(devDir)) {
            defaultPath = path.join(devDir, 'openclaw');
        } else {
            const projDir = path.join(os.homedir(), 'Projects');
            if (fs.existsSync(projDir)) {
                defaultPath = path.join(projDir, 'openclaw');
            }
        }

        wsSend(ws, 'openclaw-prereqs', { prereqs, existingInstall, defaultPath });
    } catch (err) {
        wsSendError(ws, `Prereq check failed: ${err.message}`);
    }
}

async function handleOpenClawInstall(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    
    if (!manager) {
        wsSendError(ws, 'OpenClaw Manager not available');
        return;
    }

    const { path: installPath } = data.payload;
    manager.config.path = installPath;
    
    try {
        const result = await manager.install((step, status, detail) => {
            wsSend(ws, 'openclaw-install-progress', { step, status, detail });
        });

        wsSend(ws, 'openclaw-install-complete', {
            success: result.success,
            error: result.error,
            gatewayUrl: manager.config.url,
        });
        
        sendClawStatus(ws, manager);
    } catch (err) {
        wsSend(ws, 'openclaw-install-complete', { success: false, error: err.message });
    }
}

export const handlers = {
    'openclaw-status': handleOpenClawStatus,
    'openclaw-config': handleOpenClawConfig,
    'openclaw-deploy': handleOpenClawDeploy,
    'openclaw-check-prereqs': handleCheckPrereqs,
    'openclaw-install': handleOpenClawInstall
};
