/**
 * Oboto OpenClaw Plugin
 *
 * Provides integration with the OpenClaw AI agent platform — delegate tasks,
 * manage sessions, check status, install & deploy the gateway.
 *
 * Extracted from:
 *   - src/execution/handlers/openclaw-handlers.mjs
 *   - src/tools/definitions/openclaw-tools.mjs
 *   - src/server/ws-handlers/openclaw-handler.mjs
 *   - src/integration/openclaw/client.mjs  → ./client.mjs
 *   - src/integration/openclaw/manager.mjs → ./manager.mjs
 *
 * @module @oboto/plugin-openclaw
 */

import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { OpenClawManager } from './manager.mjs';

// ── Tool handlers ────────────────────────────────────────────────────────
// NOTE: Plugin state is stored on the `api` object (via `api._pluginInstance`)
// rather than in a module-level variable. This ensures that when the plugin is
// reloaded (which creates a new ES module instance due to cache-busting), the
// old module's `deactivate()` can still reference and clean up the manager via
// `api._pluginInstance`, and the new module starts fresh.

function handleDelegateToOpenClaw(manager) {
    return async (args) => {
        const { message, sessionKey, thinking } = args;

        if (!manager || !manager.client) {
            return 'Error: OpenClaw integration is not available.';
        }

        if (!manager.client.isConnected) {
            return 'Error: OpenClaw is not connected. Use openclaw_status to check the connection.';
        }

        try {
            const params = {
                message,
                idempotencyKey: crypto.randomUUID()
            };

            if (sessionKey) params.sessionKey = sessionKey;
            if (thinking) params.thinking = thinking;

            const result = await manager.client.sendRequest('agent', params);

            if (result && result.response) {
                return `OpenClaw Response:\n${result.response}`;
            }

            return `OpenClaw completed the request.\n${JSON.stringify(result, null, 2)}`;
        } catch (error) {
            return `Error delegating to OpenClaw: ${error.message}`;
        }
    };
}

function handleOpenClawStatus(manager) {
    return async () => {
        if (!manager) {
            return 'OpenClaw integration is not configured.';
        }

        const status = {
            mode: manager.config.mode,
            url: manager.config.url,
            clientCreated: !!manager.client,
            connected: manager.client?.isConnected || false,
            processRunning: !!manager.process
        };

        if (status.connected) {
            try {
                const health = await manager.client.sendRequest('health', {});
                status.health = health;
            } catch (error) {
                status.healthError = error.message;
            }
        }

        let response = 'OpenClaw Integration Status:\n';
        response += `  Mode: ${status.mode}\n`;
        response += `  URL: ${status.url}\n`;
        response += `  Connected: ${status.connected}\n`;
        response += `  Process Running: ${status.processRunning}\n`;

        if (status.health) {
            response += `  Health: ${JSON.stringify(status.health)}\n`;
        } else if (status.healthError) {
            response += `  Health Check Failed: ${status.healthError}\n`;
        }

        return response;
    };
}

function handleOpenClawSessions(manager) {
    return async () => {
        if (!manager || !manager.client) {
            return 'Error: OpenClaw integration is not available.';
        }

        if (!manager.client.isConnected) {
            return 'Error: OpenClaw is not connected.';
        }

        try {
            const result = await manager.client.sendRequest('sessions.list', {});

            if (!result || !result.sessions || result.sessions.length === 0) {
                return 'No active OpenClaw sessions found.';
            }

            let response = `Active OpenClaw Sessions (${result.sessions.length}):\n`;
            for (const session of result.sessions) {
                response += `  - ${session.key || session.id}: ${session.status || 'active'}`;
                if (session.channel) response += ` [${session.channel}]`;
                response += '\n';
            }

            return response;
        } catch (error) {
            return `Error listing sessions: ${error.message}`;
        }
    };
}

// ── WS handler helpers (ported from openclaw-handler.mjs) ────────────────

function buildClawStatus(manager) {
    // Mask the auth token to prevent leaking secrets over WebSocket.
    // Clients only need to know whether a token is configured, not its value.
    const rawToken = manager?.config?.authToken ?? null;
    const maskedToken = rawToken
        ? `***${rawToken.slice(-4)}`
        : null;

    return {
        available: !!manager,
        connected: manager?.client?.isConnected ?? false,
        mode: manager?.config?.mode ?? null,
        url: manager?.config?.url ?? null,
        path: manager?.config?.path ?? null,
        authToken: maskedToken
    };
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const { settings } = api;

    // Initialise the manager with plugin settings — stored on api for safe cleanup
    const manager = new OpenClawManager(settings);
    api._pluginInstance = manager;

    // Start connecting in the background (non-blocking)
    manager.start().catch((err) => {
        console.error('[openclaw-plugin] Manager failed to start:', err.message);
    });

    // ── Register tools ───────────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'delegate_to_openclaw',
        description:
            'Delegate a task or send a message to the OpenClaw AI assistant. Use this when the user explicitly asks to interact with OpenClaw (e.g., @openclaw messages), or when delegating tasks that OpenClaw is better suited for such as multi-channel messaging, browser automation, or long-running background operations.',
        parameters: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The message or task to send to OpenClaw'
                },
                sessionKey: {
                    type: 'string',
                    description: 'Optional session key to target a specific OpenClaw session'
                },
                thinking: {
                    type: 'string',
                    enum: ['off', 'minimal', 'low', 'medium', 'high'],
                    description: 'Thinking level for the OpenClaw agent'
                }
            },
            required: ['message']
        },
        handler: handleDelegateToOpenClaw(manager)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'openclaw_status',
        description:
            'Check the connection status and health of the OpenClaw integration.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        handler: handleOpenClawStatus(manager)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'openclaw_sessions',
        description: 'List active sessions on the connected OpenClaw instance.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        },
        handler: handleOpenClawSessions(manager)
    });

    // ── Register WS handlers ─────────────────────────────────────────────

    api.ws.register('status', async (_data, ctx) => {
        if (ctx && ctx.ws) {
            const send = (type, payload) => {
                ctx.ws.send(JSON.stringify({ type, ...payload }));
            };
            send('openclaw-status', buildClawStatus(manager));
        }
    });

    api.ws.register('config', async (data, ctx) => {
        if (!manager) return;
        try {
            const { restart, scope, ...config } = data.payload || data;
            await manager.setConfig(config, scope);
            if (restart) await manager.restart();
            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({ type: 'openclaw-status', ...buildClawStatus(manager) })
                );
                ctx.ws.send(
                    JSON.stringify({ type: 'status', message: 'OpenClaw configuration updated' })
                );
            }
        } catch (err) {
            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: `Failed to update OpenClaw config: ${err.message}`
                    })
                );
            }
        }
    });

    api.ws.register('deploy', async (data, ctx) => {
        if (!manager) return;
        try {
            if (data?.payload) manager.setConfig(data.payload);

            if (ctx?.ws) {
                ctx.ws.send(JSON.stringify({ type: 'status', message: 'Installing OpenClaw...' }));
            }
            await manager.install();

            if (ctx?.ws) {
                ctx.ws.send(JSON.stringify({ type: 'status', message: 'Deploying OpenClaw...' }));
            }
            manager.setConfig({ mode: 'integrated' });
            await manager.restart();

            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({ type: 'openclaw-status', ...buildClawStatus(manager) })
                );
                ctx.ws.send(JSON.stringify({ type: 'status', message: 'OpenClaw deployed' }));
            }
        } catch (err) {
            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: `Failed to deploy OpenClaw: ${err.message}`
                    })
                );
            }
        }
    });

    api.ws.register('check-prereqs', async (_data, ctx) => {
        if (!manager) return;
        try {
            const prereqs = await manager.checkPrerequisites();

            const COMMON_OPENCLAW_PATHS = [
                path.join(os.homedir(), '.openclaw-gateway'),
                path.join(os.homedir(), 'openclaw'),
                path.join(os.homedir(), 'Development', 'openclaw'),
                path.join(os.homedir(), 'Projects', 'openclaw'),
                '/opt/openclaw',
                '/usr/local/openclaw'
            ];

            if (manager.config.path) COMMON_OPENCLAW_PATHS.unshift(manager.config.path);
            if (process.env.OPENCLAW_PATH)
                COMMON_OPENCLAW_PATHS.unshift(process.env.OPENCLAW_PATH);

            let existingInstall = null;
            for (const candidate of COMMON_OPENCLAW_PATHS) {
                if (!path.isAbsolute(candidate)) continue;
                if (fs.existsSync(path.join(candidate, 'openclaw.mjs'))) {
                    let pkg = null;
                    try {
                        pkg = JSON.parse(
                            fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')
                        );
                    } catch {
                        /* ignore */
                    }
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

            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({
                        type: 'openclaw-prereqs',
                        prereqs,
                        existingInstall,
                        defaultPath
                    })
                );
            }
        } catch (err) {
            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: `Prereq check failed: ${err.message}`
                    })
                );
            }
        }
    });

    api.ws.register('install', async (data, ctx) => {
        if (!manager) return;

        const installPath = data?.payload?.path || data?.path;
        if (installPath) manager.config.path = installPath;

        try {
            const result = await manager.install((step, status, detail) => {
                if (ctx?.ws) {
                    ctx.ws.send(
                        JSON.stringify({
                            type: 'openclaw-install-progress',
                            step,
                            status,
                            detail
                        })
                    );
                }
            });

            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({
                        type: 'openclaw-install-complete',
                        success: result.success,
                        error: result.error,
                        gatewayUrl: manager.config.url
                    })
                );
                ctx.ws.send(
                    JSON.stringify({ type: 'openclaw-status', ...buildClawStatus(manager) })
                );
            }
        } catch (err) {
            if (ctx?.ws) {
                ctx.ws.send(
                    JSON.stringify({
                        type: 'openclaw-install-complete',
                        success: false,
                        error: err.message
                    })
                );
            }
        }
    });
}

export async function deactivate(api) {
    if (api._pluginInstance) {
        await api._pluginInstance.stop();
        api._pluginInstance = null;
    }
}
