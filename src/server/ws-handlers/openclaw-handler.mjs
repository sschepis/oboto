import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Handles: openclaw-status, openclaw-config, openclaw-deploy, 
 * openclaw-check-prereqs, openclaw-install
 */

async function handleOpenClawStatus(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    ws.send(JSON.stringify({
        type: 'openclaw-status',
        payload: {
            available: !!manager,
            connected: manager?.client?.isConnected ?? false,
            mode: manager?.config?.mode ?? null,
            url: manager?.config?.url ?? null,
            path: manager?.config?.path ?? null,
            authToken: manager?.config?.authToken ?? null
        }
    }));
}

async function handleOpenClawConfig(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    if (manager) {
        try {
            const { restart, scope, ...config } = data.payload;
            await manager.setConfig(config, scope, assistant.workingDir);
            if (restart) {
                await manager.restart(assistant.workingDir);
            }
            
            // Send updated status
            ws.send(JSON.stringify({
                type: 'openclaw-status',
                payload: {
                    available: !!manager,
                    connected: manager?.client?.isConnected ?? false,
                    mode: manager?.config?.mode ?? null,
                    url: manager?.config?.url ?? null,
                    path: manager?.config?.path ?? null,
                    authToken: manager?.config?.authToken ?? null
                }
            }));
            ws.send(JSON.stringify({ type: 'status', payload: 'OpenClaw configuration updated' }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to update OpenClaw config: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'OpenClaw Manager not available' }));
    }
}

async function handleOpenClawDeploy(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    if (manager) {
        try {
            if (data.payload) {
                manager.setConfig(data.payload);
            }
            
            ws.send(JSON.stringify({ type: 'status', payload: 'Installing OpenClaw...' }));
            // Install first (legacy simple install)
            await manager.install();

            ws.send(JSON.stringify({ type: 'status', payload: 'Deploying OpenClaw...' }));
            manager.setConfig({ mode: 'integrated' });
            await manager.restart();
            
            // Send updated status
            ws.send(JSON.stringify({
                type: 'openclaw-status',
                payload: {
                    available: !!manager,
                    connected: manager?.client?.isConnected ?? false,
                    mode: manager?.config?.mode ?? null,
                    url: manager?.config?.url ?? null,
                    path: manager?.config?.path ?? null,
                    authToken: manager?.config?.authToken ?? null
                }
            }));
            ws.send(JSON.stringify({ type: 'status', payload: 'OpenClaw deployed' }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to deploy OpenClaw: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'OpenClaw Manager not available' }));
    }
}

async function handleCheckPrereqs(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    
    if (!manager) {
        ws.send(JSON.stringify({ type: 'error', payload: 'OpenClaw Manager not available' }));
        return;
    }

    try {
        const prereqs = await manager.checkPrerequisites();
        
        // Detect existing install
        const COMMON_OPENCLAW_PATHS = [
            path.join(os.homedir(), '.openclaw-gateway'),
            path.join(os.homedir(), 'openclaw'),
            path.join(os.homedir(), 'Development', 'openclaw'),
            path.join(os.homedir(), 'Projects', 'openclaw'),
            '/opt/openclaw',
            '/usr/local/openclaw',
        ];
        
        // Also check configured path
        if (manager.config.path) {
            COMMON_OPENCLAW_PATHS.unshift(manager.config.path);
        }
        
        // Also check env var
        if (process.env.OPENCLAW_PATH) {
            COMMON_OPENCLAW_PATHS.unshift(process.env.OPENCLAW_PATH);
        }

        let existingInstall = null;
        for (const candidate of COMMON_OPENCLAW_PATHS) {
            // Must be absolute path
            if (!path.isAbsolute(candidate)) continue;
            
            if (fs.existsSync(path.join(candidate, 'openclaw.mjs'))) {
                try {
                    const pkgPath = path.join(candidate, 'package.json');
                    if (fs.existsSync(pkgPath)) {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                        if (pkg.name === '@sschepis/openclaw') {
                            const isBuilt = fs.existsSync(path.join(candidate, 'dist', 'index.js'));
                            existingInstall = {
                                found: true,
                                path: candidate,
                                version: pkg.version,
                                isBuilt,
                                hasNodeModules: fs.existsSync(path.join(candidate, 'node_modules'))
                            };
                            break;
                        }
                    }
                } catch {}
            }
        }
        if (!existingInstall) existingInstall = { found: false };

        // Determine smart default path
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

        ws.send(JSON.stringify({
            type: 'openclaw-prereqs',
            payload: { prereqs, existingInstall, defaultPath }
        }));
    } catch (err) {
        ws.send(JSON.stringify({ type: 'error', payload: `Prereq check failed: ${err.message}` }));
    }
}

async function handleOpenClawInstall(data, ctx) {
    const { ws, assistant } = ctx;
    const manager = assistant?.openClawManager;
    
    if (!manager) {
        ws.send(JSON.stringify({ type: 'error', payload: 'OpenClaw Manager not available' }));
        return;
    }

    const { path: installPath, method = 'source', resumeFrom } = data.payload;

    // Update manager config with new path
    manager.config.path = installPath;
    
    const sendProgress = (step, status, detail, extra = {}) => {
        ws.send(JSON.stringify({
            type: 'openclaw-install-progress',
            payload: { step, status, detail, ...extra }
        }));
    };

    try {
        const result = await manager.install((step, status, detail) => {
            sendProgress(step, status, detail);
        });

        ws.send(JSON.stringify({
            type: 'openclaw-install-complete',
            payload: {
                success: result.success,
                error: result.error,
                gatewayUrl: manager.config.url,
            }
        }));
        
        // Send updated status so UI refreshes
        ws.send(JSON.stringify({
            type: 'openclaw-status',
            payload: {
                available: !!manager,
                connected: manager?.client?.isConnected ?? false,
                mode: manager?.config?.mode ?? null,
                url: manager?.config?.url ?? null,
                path: manager?.config?.path ?? null,
                authToken: manager?.config?.authToken ?? null
            }
        }));
        
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'openclaw-install-complete',
            payload: {
                success: false,
                error: err.message
            }
        }));
    }
}

export const handlers = {
    'openclaw-status': handleOpenClawStatus,
    'openclaw-config': handleOpenClawConfig,
    'openclaw-deploy': handleOpenClawDeploy,
    'openclaw-check-prereqs': handleCheckPrereqs,
    'openclaw-install': handleOpenClawInstall
};
