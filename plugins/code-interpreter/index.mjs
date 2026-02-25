/**
 * Oboto Code Interpreter Plugin
 *
 * Provides secure sandboxed code execution for Python and Node.js.
 * Uses Docker isolation when available, falls back to direct child_process
 * execution with temp files and timeouts.
 *
 * Ported from notaclaw/plugins/code-interpreter.
 *
 * @module @oboto/plugin-code-interpreter
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Execute a command safely using execFile (no shell interpolation).
 * @param {string} cmd — executable name
 * @param {string[]} args — argument array
 * @param {object} [options]
 * @returns {Promise<string>} stdout
 */
async function execSafe(cmd, args, options = {}) {
    const { stdout } = await execFileAsync(cmd, args, { ...options, encoding: 'utf8' });
    return stdout;
}

// ── CodeInterpreter core ─────────────────────────────────────────────────

class CodeInterpreter {
    constructor(api) {
        this.api = api;
        this.sessions = new Map();
        this.dockerAvailable = false;

        // Limits
        this.maxMemory = '512m';
        this.maxCpus = 1.0;
        this.defaultTimeout = 10000;   // 10 s
        this.sessionTimeout = 3600000; // 1 h
        this.cleanupInterval = null;
    }

    async init() {
        this.dockerAvailable = await this.checkDocker();
        this.allowFallback = await this.api.settings.get('allowFallbackExecution', false);
        console.log(`[code-interpreter] Docker available: ${this.dockerAvailable}, fallback allowed: ${this.allowFallback}`);

        this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000);
    }

    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        // Kill all remaining sessions
        for (const [id] of this.sessions) {
            this.endSession(id).catch(() => {});
        }
    }

    async checkDocker() {
        try {
            await execSafe('docker', ['--version']);
            return true;
        } catch {
            return false;
        }
    }

    // ── Session management ───────────────────────────────────────────────

    async createSession(language) {
        const lang = (language || 'python').toLowerCase();
        if (lang !== 'python' && lang !== 'node') {
            return { sessionId: '', error: `Unsupported language: ${lang}. Use "python" or "node".` };
        }

        const sessionId = randomUUID();
        const workDir = path.join(os.tmpdir(), `code-interpreter-${sessionId}`);
        fs.mkdirSync(workDir, { recursive: true });

        if (this.dockerAvailable) {
            return this._createDockerSession(sessionId, lang, workDir);
        }

        // Fallback mode must be explicitly opted in via plugin settings
        if (!this.allowFallback) {
            fs.rmSync(workDir, { recursive: true, force: true });
            return {
                sessionId: '',
                error: 'Docker is not available. Enable "Allow Fallback Execution" in the code-interpreter plugin settings to run code directly on the host (less secure).'
            };
        }

        return this._createFallbackSession(sessionId, lang, workDir);
    }

    async _createDockerSession(sessionId, language, workDir) {
        const image = language === 'python' ? 'python:3.9-slim' : 'node:18-slim';
        const args = [
            'run', '-d', '--rm', '--network', 'none',
            '--cpus', String(this.maxCpus),
            '--memory', this.maxMemory,
            '-v', `${workDir}:/workspace`,
            '-w', '/workspace',
            image, 'tail', '-f', '/dev/null'
        ];

        try {
            const containerId = (await execSafe('docker', args, { timeout: 30000 })).trim();
            this.sessions.set(sessionId, {
                id: sessionId,
                language,
                containerId,
                lastActive: Date.now(),
                workDir,
                mode: 'docker'
            });
            return { sessionId };
        } catch (e) {
            return { sessionId: '', error: `Failed to start Docker session: ${e.message}` };
        }
    }

    _createFallbackSession(sessionId, language, workDir) {
        this.sessions.set(sessionId, {
            id: sessionId,
            language,
            containerId: null,
            lastActive: Date.now(),
            workDir,
            mode: 'fallback'
        });
        return { sessionId };
    }

    // ── Code execution ───────────────────────────────────────────────────

    async executeCode(sessionId, code) {
        const session = this.sessions.get(sessionId);
        if (!session) return { output: '', error: 'Session not found', code: 1 };

        session.lastActive = Date.now();

        const scriptName = session.language === 'python' ? 'script.py' : 'script.js';
        const scriptPath = path.join(session.workDir, scriptName);
        fs.writeFileSync(scriptPath, code);

        if (session.mode === 'docker') {
            return this._execDocker(session, scriptName);
        }
        return this._execFallback(session, scriptName, scriptPath);
    }

    async _execDocker(session, scriptName) {
        const runtime = session.language === 'python' ? 'python' : 'node';
        const args = ['exec', session.containerId, runtime, scriptName];

        try {
            const output = await execSafe('docker', args, { timeout: this.defaultTimeout });
            return { output, code: 0 };
        } catch (e) {
            if (e.killed) return { output: '', error: 'Execution timed out', code: 124 };
            return { output: e.stdout || '', error: e.stderr || e.message, code: e.code || 1 };
        }
    }

    async _execFallback(session, scriptName, scriptPath) {
        const runtime = session.language === 'python' ? 'python3' : 'node';

        // Build a sanitized environment — strip variables that look like secrets
        // to prevent exfiltration via prompt injection in non-Docker mode.
        const safeEnv = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i.test(key)) continue;
            safeEnv[key] = value;
        }

        try {
            const output = await execSafe(runtime, [scriptPath], {
                timeout: this.defaultTimeout,
                cwd: session.workDir,
                env: { ...safeEnv, NODE_NO_WARNINGS: '1' }
            });
            return { output, code: 0 };
        } catch (e) {
            if (e.killed) return { output: '', error: 'Execution timed out', code: 124 };
            return { output: e.stdout || '', error: e.stderr || e.message, code: e.code || 1 };
        }
    }

    // ── Package installation ─────────────────────────────────────────────

    async installPackage(sessionId, packageName) {
        const session = this.sessions.get(sessionId);
        if (!session) return { success: false, error: 'Session not found' };

        if (session.mode === 'docker') {
            return { success: false, error: 'Dynamic package installation is disabled in Docker secure mode (network isolated).' };
        }

        // Validate packageName — block shell metacharacters (defense-in-depth;
        // execFile doesn't use a shell, but we still want to prevent weird names).
        if (!packageName || typeof packageName !== 'string') {
            return { success: false, error: 'Package name must be a non-empty string' };
        }
        if (/[;&|`$\\<>]/.test(packageName)) {
            return { success: false, error: 'Package name contains invalid characters' };
        }

        // Fallback mode: install locally in the workDir using execFile (no shell)
        const [cmd, ...args] = session.language === 'python'
            ? ['pip', 'install', '--target', session.workDir, packageName]
            : ['npm', 'install', '--prefix', session.workDir, packageName];

        try {
            const output = await execSafe(cmd, args, { timeout: 60000 });
            return { success: true, output };
        } catch (e) {
            return { success: false, error: e.stderr || e.message };
        }
    }

    // ── File upload ──────────────────────────────────────────────────────

    uploadFile(sessionId, filename, content) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found');

        // Security: prevent path traversal — resolved path must stay inside workDir
        const resolved = path.resolve(session.workDir, filename);
        if (!resolved.startsWith(session.workDir + path.sep) && resolved !== session.workDir) {
            throw new Error('Filename escapes session workspace');
        }

        fs.writeFileSync(resolved, content);
        return { success: true, path: `/workspace/${filename}` };
    }

    // ── End session ──────────────────────────────────────────────────────

    async endSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return { success: false, error: 'Session not found' };

        if (session.mode === 'docker' && session.containerId) {
            try {
                await execSafe('docker', ['kill', session.containerId], { timeout: 10000 });
            } catch {
                // Container may already be gone
            }
        }

        try {
            fs.rmSync(session.workDir, { recursive: true, force: true });
        } catch {
            // Temp dir cleanup best-effort
        }

        this.sessions.delete(sessionId);
        return { success: true };
    }

    // ── Cleanup stale sessions ───────────────────────────────────────────

    cleanupSessions() {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (now - session.lastActive > this.sessionTimeout) {
                this.endSession(id).catch(() => {});
            }
        }
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

// NOTE: Plugin state is stored on the `api` object rather than in a module-level
// variable. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up the interpreter via `api._pluginInstance`, and the
// new module starts fresh.

export async function activate(api) {
    console.log('[code-interpreter] Activating...');

    const interpreter = new CodeInterpreter(api);
    await interpreter.init();

    // Store instance on api so deactivate() can access it even after ESM reload
    api._pluginInstance = interpreter;

    // ── Tool: create session ─────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'code_create_session',
        description: 'Create a new code execution session. Returns a sessionId for subsequent execute/upload calls. Supports "python" or "node".',
        parameters: {
            type: 'object',
            properties: {
                language: {
                    type: 'string',
                    description: 'Programming language: "python" or "node"',
                    enum: ['python', 'node']
                }
            },
            required: ['language']
        },
        handler: async (args) => {
            const result = await interpreter.createSession(args.language);
            if (result.error) return `Error: ${result.error}`;
            return result;
        }
    });

    // ── Tool: execute code ───────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'code_execute',
        description: 'Execute code in a previously created session. Returns stdout output, errors, and exit code.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID from code_create_session' },
                code: { type: 'string', description: 'Source code to execute' }
            },
            required: ['sessionId', 'code']
        },
        handler: async (args) => {
            const result = await interpreter.executeCode(args.sessionId, args.code);
            // Stream output via WebSocket if available
            if (result.output) {
                api.ws.broadcast('code:output', {
                    sessionId: args.sessionId,
                    output: result.output,
                    error: result.error,
                    exitCode: result.code
                });
            }
            return result;
        }
    });

    // ── Tool: install package ────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'code_install_package',
        description: 'Install a package in an existing code session. Only works in fallback (non-Docker) mode.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID' },
                packageName: { type: 'string', description: 'Package name to install (e.g. "numpy" or "lodash")' }
            },
            required: ['sessionId', 'packageName']
        },
        handler: async (args) => interpreter.installPackage(args.sessionId, args.packageName)
    });

    // ── Tool: end session ────────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'code_end_session',
        description: 'End a code execution session and clean up resources.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to terminate' }
            },
            required: ['sessionId']
        },
        handler: async (args) => interpreter.endSession(args.sessionId)
    });

    // ── Tool: upload file ────────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'code_upload_file',
        description: 'Upload a file into a code execution session workspace.',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID' },
                filename: { type: 'string', description: 'Name for the uploaded file' },
                content: { type: 'string', description: 'File content (text)' }
            },
            required: ['sessionId', 'filename', 'content']
        },
        handler: async (args) => interpreter.uploadFile(args.sessionId, args.filename, args.content)
    });

    // ── WebSocket handler for real-time output streaming ─────────────────
    api.ws.register('code:execute', async (data, ctx) => {
        if (!data.sessionId || !data.code) {
            ctx.ws.send(JSON.stringify({
                type: 'plugin:code-interpreter:error',
                payload: { error: 'Missing sessionId or code' }
            }));
            return;
        }

        const result = await interpreter.executeCode(data.sessionId, data.code);
        ctx.ws.send(JSON.stringify({
            type: 'plugin:code-interpreter:result',
            payload: {
                sessionId: data.sessionId,
                output: result.output,
                error: result.error,
                exitCode: result.code
            }
        }));
    });

    console.log(`[code-interpreter] Activated (Docker: ${interpreter.dockerAvailable})`);
}

export async function deactivate(api) {
    console.log('[code-interpreter] Deactivating...');
    if (api._pluginInstance) {
        api._pluginInstance.destroy();
        api._pluginInstance = null;
    }
}
