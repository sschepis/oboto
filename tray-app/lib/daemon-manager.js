/**
 * DaemonManager — spawns, monitors, and restarts the Oboto server
 * as a child process of the Electron tray app.
 *
 * Communication flow:
 *   Tray  ──fork──▶  node ai.mjs --server   (child process)
 *   Tray  ──WS────▶  ws://localhost:{port}   (status monitoring)
 */

const { EventEmitter } = require('events');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

/** How long to wait for a graceful shutdown before SIGKILL. */
const KILL_TIMEOUT_MS = 5000;

/** How long to wait before connecting WS after process spawn. */
const WS_CONNECT_DELAY_MS = 3000;

/** How often to retry WS connection. */
const WS_RETRY_INTERVAL_MS = 5000;

class DaemonManager extends EventEmitter {
    /**
     * @param {import('./preferences')} preferences
     */
    constructor(preferences) {
        super();

        /** @type {import('child_process').ChildProcess | null} */
        this.serverProcess = null;

        /** @type {WebSocket | null} */
        this.wsClient = null;

        this.preferences = preferences;

        this.state = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
        this.workspacePath = null;
        this.port = 3000;

        this._wsRetryTimer = null;
        this._lastStatus = null;
    }

    // ── Public API ─────────────────────────────────────────────

    /**
     * Start the server daemon for the given workspace.
     * @param {string} workspacePath  – absolute path to workspace directory
     * @param {number} [port=3000]
     */
    async start(workspacePath, port) {
        if (this.serverProcess) {
            await this.stop();
        }

        this.workspacePath = workspacePath;
        this.port = port || this.preferences.get('port') || 3000;
        this.state = 'starting';
        this.emit('state-changed', this.state);

        // Resolve path to ai.mjs relative to the oboto project
        let projectRoot;
        
        // In packaged app, extraResources puts the backend in resources/backend
        const packagedBackendPath = process.resourcesPath ? path.join(process.resourcesPath, 'backend') : null;
        
        if (packagedBackendPath && fs.existsSync(packagedBackendPath)) {
            projectRoot = packagedBackendPath;
            this.emit('log', `Using packaged backend at: ${projectRoot}`);
        } else {
            // Development: The tray-app lives inside the project at tray-app/
            projectRoot = path.resolve(__dirname, '..', '..');
            this.emit('log', `Using development backend at: ${projectRoot}`);
        }

        const aiMjsPath = path.join(projectRoot, 'ai.mjs');

        const env = {
            ...process.env,
            PORT: String(this.port),
            ROBODEV_AUTO_ACTIVATE: this.preferences.get('autoActivateOnStart') ? 'true' : 'false',
        };

        try {
            this.serverProcess = fork(aiMjsPath, ['--server'], {
                cwd: workspacePath,
                env,
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                // silent: false would inherit parent stdio, but we want to capture it
            });

            // Capture stdout
            this.serverProcess.stdout.on('data', (data) => {
                const line = data.toString().trim();
                if (line) {
                    this.emit('log', line);
                    // Detect readiness
                    if (line.includes('Server running at')) {
                        this._onServerReady();
                    }
                }
            });

            // Capture stderr
            this.serverProcess.stderr.on('data', (data) => {
                const line = data.toString().trim();
                if (line) this.emit('log', `[stderr] ${line}`);
            });

            // Handle exit
            this.serverProcess.on('exit', (code, signal) => {
                this.emit('log', `Server exited (code: ${code}, signal: ${signal})`);
                this.serverProcess = null;
                this._disconnectWs();

                if (this.state !== 'stopped') {
                    this.state = 'error';
                    this.emit('state-changed', this.state);
                }
            });

            this.serverProcess.on('error', (err) => {
                this.emit('log', `Server process error: ${err.message}`);
                this.state = 'error';
                this.emit('state-changed', this.state);
            });

        } catch (err) {
            this.state = 'error';
            this.emit('state-changed', this.state);
            this.emit('log', `Failed to start daemon: ${err.message}`);
            throw err;
        }
    }

    /**
     * Stop the daemon gracefully.
     */
    async stop() {
        this._disconnectWs();
        this.state = 'stopped';

        if (!this.serverProcess) {
            this.emit('state-changed', this.state);
            return;
        }

        return new Promise((resolve) => {
            const proc = this.serverProcess;

            const killTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch {}
                resolve();
            }, KILL_TIMEOUT_MS);

            proc.once('exit', () => {
                clearTimeout(killTimer);
                this.serverProcess = null;
                this.emit('state-changed', this.state);
                resolve();
            });

            try {
                proc.kill('SIGTERM');
            } catch {
                clearTimeout(killTimer);
                this.serverProcess = null;
                this.emit('state-changed', this.state);
                resolve();
            }
        });
    }

    /**
     * Restart with the same or a new workspace.
     * @param {string} [workspacePath]
     * @param {number} [port]
     */
    async restart(workspacePath, port) {
        await this.stop();
        await this.start(
            workspacePath || this.workspacePath,
            port || this.port
        );
    }

    /**
     * Switch to a different workspace directory (restarts the daemon).
     * @param {string} newPath
     */
    async switchWorkspace(newPath) {
        this.emit('log', `Switching workspace to: ${newPath}`);
        this.preferences.setCurrentWorkspace(newPath);
        await this.restart(newPath);
    }

    /**
     * Send a message to the daemon over the WS connection.
     * @param {object} message
     */
    send(message) {
        if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(JSON.stringify(message));
        }
    }

    /**
     * Request service status.
     */
    requestStatus() {
        this.send({ type: 'service:status' });
    }

    /**
     * Get the last known status.
     */
    getLastStatus() {
        return this._lastStatus;
    }

    /**
     * Check if daemon is running.
     */
    isRunning() {
        return this.state === 'running' && this.serverProcess !== null;
    }

    // ── Internal ───────────────────────────────────────────────

    _onServerReady() {
        this.state = 'running';
        this.emit('state-changed', this.state);
        this.emit('log', 'Server is ready — connecting WS monitor...');

        // Connect WebSocket after a brief delay
        setTimeout(() => this._connectWs(), WS_CONNECT_DELAY_MS);
    }

    _connectWs() {
        if (this.wsClient) {
            try { this.wsClient.close(); } catch {}
        }

        try {
            const url = `ws://localhost:${this.port}`;
            this.wsClient = new WebSocket(url);

            this.wsClient.on('open', () => {
                this.emit('log', 'WS monitor connected');
                this.emit('ws-connected');
                // Request initial status
                this.requestStatus();
            });

            this.wsClient.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this._handleWsMessage(msg);
                } catch {}
            });

            this.wsClient.on('close', () => {
                this.emit('ws-disconnected');
                // Retry if daemon is still supposed to be running
                if (this.state === 'running') {
                    this._scheduleWsRetry();
                }
            });

            this.wsClient.on('error', () => {
                // Retry silently
                if (this.state === 'running') {
                    this._scheduleWsRetry();
                }
            });

        } catch (err) {
            this.emit('log', `WS connection failed: ${err.message}`);
            this._scheduleWsRetry();
        }
    }

    _disconnectWs() {
        if (this._wsRetryTimer) {
            clearTimeout(this._wsRetryTimer);
            this._wsRetryTimer = null;
        }
        if (this.wsClient) {
            try { this.wsClient.close(); } catch {}
            this.wsClient = null;
        }
    }

    _scheduleWsRetry() {
        if (this._wsRetryTimer) return;
        this._wsRetryTimer = setTimeout(() => {
            this._wsRetryTimer = null;
            if (this.state === 'running') {
                this._connectWs();
            }
        }, WS_RETRY_INTERVAL_MS);
    }

    _handleWsMessage(msg) {
        const { type, payload } = msg;

        switch (type) {
            case 'service:status-response':
                this._lastStatus = payload;
                this.emit('status', payload);
                break;

            case 'workspace:status':
                this.emit('workspace-status', payload);
                break;

            case 'agent-loop-state':
                this.emit('agent-loop-state', payload);
                break;

            case 'task-completed':
                this.emit('task-completed', payload);
                break;

            case 'task-failed':
                this.emit('task-failed', payload);
                break;

            default:
                // Forward other messages as generic events
                this.emit('ws-message', msg);
                break;
        }
    }
}

module.exports = { DaemonManager };
