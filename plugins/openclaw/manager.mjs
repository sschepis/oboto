/**
 * OpenClaw Manager
 *
 * Manages the OpenClaw integration lifecycle: configuration, process
 * management (integrated mode), and client connection with retry logic.
 *
 * Ported from src/integration/openclaw/manager.mjs.
 *
 * @module @oboto/plugin-openclaw/manager
 */

import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { OpenClawClient } from './client.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

export class OpenClawManager {
    /** Minimum interval (ms) between successive restart() calls. */
    static RESTART_DEBOUNCE_MS = 3000;

    /**
     * @param {object} [settingsStore] — plugin settings store (api.settings)
     */
    constructor(settingsStore = null) {
        this.settingsStore = settingsStore;
        this.client = null;
        this.process = null;
        /** @type {number} Timestamp (ms) of the last accepted restart call. */
        this._lastRestartAt = 0;
        this.config = {
            mode: process.env.OPENCLAW_MODE || 'external',
            url: process.env.OPENCLAW_URL || 'ws://127.0.0.1:18789',
            authToken: process.env.OPENCLAW_AUTH_TOKEN,
            path: process.env.OPENCLAW_PATH
        };
    }

    /**
     * Starts the OpenClaw integration.
     * Spawns process if integrated, then connects client.
     * @param {string} [workspaceDir] — optional workspace directory
     */
    async start(workspaceDir = null) {
        // Merge plugin settings into config
        if (this.settingsStore) {
            const apiKey = await this.settingsStore.get('openClawApiKey');
            const baseUrl = await this.settingsStore.get('openClawBaseUrl');
            if (apiKey) this.config.authToken = apiKey;
            if (baseUrl) this.config.url = baseUrl;
        }

        if (workspaceDir) {
            await this.loadConfig(workspaceDir);
        }

        consoleStyler.log('plugin', `Starting in ${this.config.mode} mode...`);

        if (this.config.mode === 'integrated') {
            try {
                await this.spawnProcess();
            } catch (err) {
                consoleStyler.log('error', `Failed to spawn process, continuing without it: ${err.message}`);
            }
        }

        this.client = new OpenClawClient(this.config.url, this.config.authToken);

        this.client.on('connected', () => {
            consoleStyler.log('plugin', 'Client connected successfully');
        });

        this.client.on('disconnected', () => {
            consoleStyler.log('plugin', 'Client disconnected');
        });

        this.client.on('error', (err) => {
            consoleStyler.logError('error', 'Client error', err);
        });

        this.connectWithRetry();
    }

    /**
     * Load configuration with workspace overrides.
     * @param {string} workspaceDir
     */
    async loadConfig(workspaceDir) {
        this.config = {
            mode: process.env.OPENCLAW_MODE || 'external',
            url: process.env.OPENCLAW_URL || 'ws://127.0.0.1:18789',
            authToken: process.env.OPENCLAW_AUTH_TOKEN,
            path: process.env.OPENCLAW_PATH
        };

        if (workspaceDir) {
            const localConfigPath = path.join(workspaceDir, '.oboto', 'openclaw.json');
            if (fs.existsSync(localConfigPath)) {
                try {
                    const content = await fs.promises.readFile(localConfigPath, 'utf8');
                    const localConfig = JSON.parse(content);
                    consoleStyler.log('openclaw', `Loaded workspace override from ${localConfigPath}`);
                    this.config = { ...this.config, ...localConfig };
                } catch (err) {
                    consoleStyler.log('warning', `Failed to load workspace config: ${err.message}`);
                }
            }
        }
    }

    /**
     * Connects to OpenClaw with retry logic.
     * @param {number} [retries=5]
     * @param {number} [delay=2000]
     */
    async connectWithRetry(retries = 5, delay = 2000) {
        for (let i = 0; i < retries; i++) {
            try {
                await this.client.connect();
                return;
            } catch {
                if (i < retries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }
        consoleStyler.log('error', 'Failed to connect after multiple attempts');
    }

    /**
     * Enhanced install method with progress reporting.
     * @param {Function} [onProgress] — (step, status, detail) => void
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async install(onProgress = () => {}) {
        if (!this.config.path) {
            throw new Error('OPENCLAW_PATH is required for installation');
        }

        try {
            // Step 1: Prerequisites
            onProgress('prereqs', 'running', 'Checking prerequisites...');
            const prereqs = await this.checkPrerequisites();
            if (!prereqs.node.sufficient) {
                throw new Error(
                    `Node.js >= 22 required (found: ${prereqs.node.version || 'not installed'})`
                );
            }
            if (!prereqs.pnpm.installed) {
                onProgress('prereqs', 'running', 'Installing pnpm...');
                await this.runCommand('npm', ['install', '-g', 'pnpm@latest']);
            }
            if (!prereqs.git.installed) {
                throw new Error('git is required but not installed');
            }
            onProgress('prereqs', 'done', 'Prerequisites verified');

            // Step 2: Clone or update
            if (fs.existsSync(this.config.path)) {
                const isGitRepo = fs.existsSync(path.join(this.config.path, '.git'));
                if (isGitRepo) {
                    onProgress('clone', 'running', 'Updating existing repository...');
                    await this.runCommand('git', ['pull', '--rebase'], {
                        cwd: this.config.path
                    });
                } else {
                    const hasOpenClaw = fs.existsSync(
                        path.join(this.config.path, 'openclaw.mjs')
                    );
                    if (!hasOpenClaw) {
                        throw new Error(
                            `Path ${this.config.path} exists but is not an OpenClaw repository`
                        );
                    }
                    onProgress('clone', 'skipped', 'Using existing installation');
                }
            } else {
                onProgress('clone', 'running', 'Cloning repository...');
                await this.runCommand('git', [
                    'clone',
                    '--depth',
                    '1',
                    'https://github.com/sschepis/openclaw.git',
                    this.config.path
                ]);
            }
            onProgress('clone', 'done', 'Repository ready');

            // Step 3: Install dependencies
            onProgress(
                'install',
                'running',
                'Installing dependencies (this may take a few minutes)...'
            );
            await this.runCommand('pnpm', ['install', '--frozen-lockfile'], {
                cwd: this.config.path,
                env: {
                    ...process.env,
                    OPENCLAW_SKIP_COMPLETION_SETUP: '1'
                }
            });
            onProgress('install', 'done', 'Dependencies installed');

            // Step 4: Build
            onProgress('build', 'running', 'Building OpenClaw...');
            await this.runCommand('pnpm', ['build'], { cwd: this.config.path });
            onProgress('build', 'done', 'Build complete');

            // Step 5: Build UI
            onProgress('ui-build', 'running', 'Building UI...');
            await this.runCommand('pnpm', ['ui:build'], { cwd: this.config.path });
            onProgress('ui-build', 'done', 'UI built');

            // Step 6: Generate auth token
            onProgress('auth-token', 'running', 'Generating gateway auth token...');
            const cryptoMod = await import('crypto');
            const authToken = cryptoMod.randomBytes(32).toString('hex');
            this.config.authToken = authToken;
            onProgress('auth-token', 'done', 'Auth token generated');

            // Step 7: Save configuration
            onProgress('config', 'running', 'Saving configuration...');
            this.config.mode = 'integrated';
            this.config.url = 'ws://127.0.0.1:18789';

            // Auto-configure the gateway itself
            const gatewayConfig = {
                gateway: {
                    bind: 'loopback',
                    port: 18789
                }
            };
            const configDir = path.join(os.homedir(), '.openclaw');
            if (!fs.existsSync(configDir)) {
                await fs.promises.mkdir(configDir, { recursive: true });
            }
            await fs.promises.writeFile(
                path.join(configDir, 'openclaw.json'),
                JSON.stringify(gatewayConfig, null, 2)
            );

            // Persist to plugin settings if available
            if (this.settingsStore) {
                await this.settingsStore.set('openClawApiKey', authToken);
                await this.settingsStore.set('openClawBaseUrl', this.config.url);
            }

            onProgress('config', 'done', 'Configuration saved');

            // Step 8: Start gateway
            onProgress('start', 'running', 'Starting OpenClaw gateway...');
            await this.stop();
            await this.spawnProcess();
            onProgress('start', 'done', 'Gateway process started');

            // Step 9: Health check
            onProgress('health-check', 'running', 'Verifying gateway is healthy...');
            const healthy = await this.healthCheck(15, 2000);
            if (!healthy) {
                throw new Error('Gateway started but health check failed (timeout)');
            }
            onProgress('health-check', 'done', 'Gateway is running and healthy');

            return { success: true };
        } catch (err) {
            consoleStyler.logError('error', 'Install failed', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Check system prerequisites for installation.
     * @returns {Promise<object>}
     */
    async checkPrerequisites() {
        const results = {
            node: { installed: false, version: null, sufficient: false },
            git: { installed: false, version: null },
            pnpm: { installed: false, version: null, sufficient: false },
            docker: { installed: false, version: null }
        };

        const execAsync = (cmd) =>
            new Promise((resolve, reject) => {
                exec(cmd, (error, stdout, stderr) => {
                    if (error) reject(error);
                    else resolve({ stdout, stderr });
                });
            });

        // Check Node.js
        try {
            const nodeVersion = process.version;
            const major = parseInt(nodeVersion.slice(1).split('.')[0]);
            results.node = {
                installed: true,
                version: nodeVersion,
                sufficient: major >= 22
            };
        } catch {
            /* empty */
        }

        // Check git
        try {
            const { stdout } = await execAsync('git --version');
            const match = stdout.match(/git version (\S+)/);
            results.git = {
                installed: true,
                version: match ? match[1] : stdout.trim()
            };
        } catch {
            /* empty */
        }

        // Check pnpm
        try {
            const { stdout } = await execAsync('pnpm --version');
            const version = stdout.trim();
            const major = parseInt(version.split('.')[0]);
            results.pnpm = {
                installed: true,
                version,
                sufficient: major >= 9
            };
        } catch {
            /* empty */
        }

        // Check Docker
        try {
            const { stdout } = await execAsync('docker --version');
            results.docker = {
                installed: true,
                version: stdout.trim()
            };
        } catch {
            /* empty */
        }

        return results;
    }

    /**
     * Run a command as a child process.
     * @param {string} command
     * @param {string[]} args
     * @param {object} [options]
     * @returns {Promise<void>}
     */
    runCommand(command, args, options = {}) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, { stdio: 'inherit', ...options });
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${command} exited with code ${code}`));
            });
            proc.on('error', reject);
        });
    }

    /**
     * Run a command and capture its output.
     * @param {string} command
     * @param {string[]} args
     * @param {object} [options]
     * @returns {Promise<{stdout: string, stderr: string}>}
     */
    runCommandWithOutput(command, args, options = {}) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                ...options
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) resolve({ stdout, stderr });
                else reject(new Error(`${command} exited with code ${code}\n${stderr || stdout}`));
            });
            proc.on('error', reject);
        });
    }

    /**
     * Spawns the OpenClaw Gateway process.
     */
    async spawnProcess() {
        if (!this.config.path) {
            throw new Error('OPENCLAW_PATH is required for integrated mode');
        }

        const entryPoint = fs.existsSync(path.join(this.config.path, 'dist', 'index.js'))
            ? ['dist/index.js', 'gateway']
            : ['openclaw.mjs', 'gateway', 'run'];

        consoleStyler.log('plugin', `Spawning OpenClaw from ${this.config.path}`);

        const gatewayEnv = {
            ...process.env,
            OPENCLAW_GATEWAY_TOKEN: this.config.authToken,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
            OPENCLAW_CONFIG_DIR: path.join(os.homedir(), '.openclaw'),
            OPENCLAW_WORKSPACE_DIR: path.join(os.homedir(), '.openclaw', 'workspace')
        };

        try {
            this.process = spawn(
                'node',
                [...entryPoint, '--bind', 'loopback', '--port', '18789'],
                {
                    cwd: this.config.path,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: gatewayEnv,
                    detached: false
                }
            );

            this.process.stdout?.on('data', () => {
                /* pipe but discard stdout */
            });
            this.process.stderr?.on('data', () => {
                /* pipe but discard stderr */
            });

            this.process.on('error', (err) => {
                consoleStyler.logError('error', 'Process spawn error', err);
            });

            this.process.on('exit', (code, signal) => {
                consoleStyler.log('openclaw', `Process exited with code ${code} signal ${signal}`);
                this.process = null;
            });

            await this.waitForReady(10, 1500);
        } catch (err) {
            consoleStyler.logError('error', 'Failed to spawn process', err);
            throw err;
        }
    }

    /**
     * Wait for the gateway's HTTP health endpoint to respond.
     * @param {number} [retries=10]
     * @param {number} [delay=1500]
     */
    async waitForReady(retries = 10, delay = 1500) {
        for (let i = 0; i < retries; i++) {
            try {
                const res = await fetch('http://127.0.0.1:18789/health', {
                    signal: AbortSignal.timeout(2000)
                });
                if (res.ok) {
                    consoleStyler.log('plugin', 'Gateway is ready');
                    return;
                }
            } catch {
                /* not ready yet */
            }

            if (i < retries - 1) {
                await new Promise((r) => setTimeout(r, delay));
            }
        }
        consoleStyler.log('warning', 'Gateway may not be fully ready');
    }

    /**
     * Check if the gateway is healthy.
     * @param {number} [retries=5]
     * @param {number} [delay=2000]
     * @returns {Promise<boolean>}
     */
    async healthCheck(retries = 5, delay = 2000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch('http://127.0.0.1:18789/health', {
                    signal: AbortSignal.timeout(3000)
                });
                if (response.ok) return true;
            } catch {
                /* not healthy yet */
            }

            if (i < retries - 1) {
                await new Promise((r) => setTimeout(r, delay));
            }
        }
        return false;
    }

    /**
     * Stops the OpenClaw integration.
     */
    async stop() {
        consoleStyler.log('plugin', 'Stopping...');
        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }

        if (this.process) {
            consoleStyler.log('plugin', 'Killing process...');
            this.process.kill();

            setTimeout(() => {
                if (this.process) {
                    try {
                        this.process.kill('SIGKILL');
                    } catch {
                        /* ignore */
                    }
                }
            }, 5000);

            this.process = null;
        }
    }

    /**
     * Updates configuration dynamically and optionally persists it.
     * @param {object} newConfig — partial config object
     * @param {string} [scope='session'] — 'session' | 'global' | 'workspace'
     * @param {string} [workspaceDir] — required if scope is 'workspace'
     */
    async setConfig(newConfig, scope = 'session', workspaceDir = null) {
        this.config = { ...this.config, ...newConfig };
        consoleStyler.log('plugin', `[OpenClawManager] Configuration updated: ${this.config}`);

        if (scope === 'global' && this.settingsStore) {
            if (newConfig.authToken)
                await this.settingsStore.set('openClawApiKey', newConfig.authToken);
            if (newConfig.url)
                await this.settingsStore.set('openClawBaseUrl', newConfig.url);
            consoleStyler.log('plugin', 'Global configuration saved to plugin settings');
        } else if (scope === 'workspace' && workspaceDir) {
            const configDir = path.join(workspaceDir, '.oboto');
            if (!fs.existsSync(configDir)) {
                await fs.promises.mkdir(configDir, { recursive: true });
            }
            const localConfigPath = path.join(configDir, 'openclaw.json');

            const toSave = {
                mode: this.config.mode,
                url: this.config.url,
                authToken: this.config.authToken,
                path: this.config.path
            };
            await fs.promises.writeFile(localConfigPath, JSON.stringify(toSave, null, 2));
            consoleStyler.log('openclaw', `Workspace configuration saved to ${localConfigPath}`);
        }
    }

    /**
     * Restarts the manager with current configuration.
     * @param {string} [workspaceDir]
     */
    async restart(workspaceDir = null) {
        const now = Date.now();
        if (now - this._lastRestartAt < OpenClawManager.RESTART_DEBOUNCE_MS) {
            consoleStyler.log('openclaw', 'Restart debounced — skipping (too soon after last restart)');
            return;
        }
        this._lastRestartAt = now;

        consoleStyler.log('plugin', 'Restarting...');
        await this.stop();
        await this.start(workspaceDir);
    }
}
