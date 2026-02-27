import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { consoleStyler } from '../ui/console-styler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PTY_BRIDGE_SCRIPT = path.join(__dirname, 'scripts', 'pty-bridge.py');

// Lazy-loaded node-pty (native addon).  Loaded on first terminal connection
// instead of at module scope to avoid blocking the entire import graph and to
// tolerate environments where the native addon isn't installed.
let _pty;          // undefined = not yet attempted, null = unavailable
async function loadPty() {
    if (_pty !== undefined) return _pty;
    try {
        _pty = await import('node-pty');
        if (_pty.default) _pty = _pty.default;
    } catch {
        _pty = null;
    }
    return _pty;
}

export class TerminalService {
    /**
     * Attach the terminal service to a WebSocket server.
     * @param {WebSocketServer} wss - The WebSocket server instance for terminal connections.
     * @param {Object} assistant - The assistant instance (optional, for workingDir).
     */
    static attach(wss, assistant) {
        setupTerminalWebSocket(wss, assistant);
    }
}

/**
 * Set up the terminal PTY WebSocket server.
 * Each connected client gets its own pseudo-terminal via node-pty.
 */
function setupTerminalWebSocket(terminalWss, assistant) {
    const defaultShell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');

    terminalWss.on('connection', async (ws, req) => {
        // Security: only allow connections from localhost.  The terminal
        // WebSocket spawns a real shell with full process privileges — it
        // must never be exposed to remote clients.
        // Fail *closed* — reject if the remote address is missing or not a
        // recognised localhost variant.
        const LOCALHOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
        const remote = req?.socket?.remoteAddress;
        if (!remote || !LOCALHOST_ADDRS.has(remote)) {
            consoleStyler.log('warning', `Terminal connection rejected from non-local address: ${remote ?? 'unknown'}`);
            ws.close(4003, 'Terminal access restricted to localhost');
            return;
        }

        const cwd = assistant?.workingDir || process.cwd();
        
        // Lazy-load node-pty on first connection
        const pty = await loadPty();

        // Try node-pty first
        if (pty) {
            consoleStyler.log('system', `Terminal PTY session started (shell: ${defaultShell}, cwd: ${cwd})`);
            
            let ptyProcess;
            try {
                ptyProcess = pty.spawn(defaultShell, [], {
                    name: 'xterm-256color',
                    cols: 120,
                    rows: 30,
                    cwd,
                    env: {
                        ...process.env,
                        TERM: 'xterm-256color',
                        COLORTERM: 'truecolor',
                    },
                });
            } catch (err) {
                consoleStyler.log('error', `Failed to spawn PTY: ${err.message}. Falling back.`);
                // Fall back to Python PTY bridge if node-pty spawn fails
                setupPythonPty(ws, defaultShell, cwd);
                return;
            }

            // PTY → Client
            ptyProcess.onData((data) => {
                if (ws.readyState === 1) {
                    ws.send(data);
                }
            });

            ptyProcess.onExit(({ exitCode, signal }) => {
                consoleStyler.log('system', `Terminal PTY exited (code: ${exitCode}, signal: ${signal})`);
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
                    ws.close();
                }
            });

            // Client → PTY
            ws.on('message', (message) => {
                try {
                    // Try parsing as JSON for control messages
                    if (typeof message === 'string' || (message instanceof Buffer && message[0] === 0x7b)) {
                        const str = message.toString();
                        if (str.startsWith('{')) {
                            const parsed = JSON.parse(str);
                            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
                                try {
                                    ptyProcess.resize(parseInt(parsed.cols, 10), parseInt(parsed.rows, 10));
                                } catch (e) {
                                    // ignore resize errors
                                }
                                return;
                            }
                        }
                    }
                } catch {
                    // Not JSON — treat as terminal input
                }
                // Forward raw input to PTY
                try {
                    ptyProcess.write(message.toString());
                } catch (e) {
                    // ignore write errors
                }
            });

            ws.on('close', () => {
                consoleStyler.log('system', 'Terminal PTY session closed');
                try {
                    ptyProcess.kill();
                } catch {
                    // Already dead
                }
            });

            ws.on('error', (err) => {
                consoleStyler.log('error', `Terminal WS error: ${err.message}`);
                try {
                    ptyProcess.kill();
                } catch {
                    // Already dead
                }
            });

            // Send initial ready signal
            ws.send(JSON.stringify({ type: 'ready', shell: defaultShell, cwd }));

        } else {
            consoleStyler.log('warning', 'node-pty not available — using Python PTY bridge');
            setupPythonPty(ws, defaultShell, cwd);
        }
    });
}

/**
 * Uses Python's pty module to create a real pseudo-terminal when node-pty is unavailable.
 */
function setupPythonPty(ws, shellCommand, cwd) {
    try {
        consoleStyler.log('system', `Spawning Python PTY bridge for: ${shellCommand}`);
        
        const shellProcess = spawn('python3', [PTY_BRIDGE_SCRIPT, shellCommand], {
            cwd,
            env: { ...process.env, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        shellProcess.stdout.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.on('exit', (code) => {
            consoleStyler.log('system', `Python PTY exited (code: ${code})`);
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'exit', exitCode: code }));
                ws.close();
            }
        });
        
        shellProcess.on('error', (err) => {
             consoleStyler.log('error', `Python PTY failed: ${err.message}. Falling back to dumb shell.`);
             setupDumbShell(ws, shellCommand, cwd);
        });

        ws.on('message', (message) => {
            try {
                const str = message.toString();
                // Parse JSON control messages (e.g. resize) but forward
                // everything else — including text that starts with '{' —
                // to the shell's stdin.
                if (str.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(str);
                        if (parsed.type === 'resize') {
                            // Python PTY bridge doesn't support resize — ignore
                            return;
                        }
                    } catch {
                        // Not valid JSON — fall through to write as shell input
                    }
                }
                if (shellProcess.stdin && !shellProcess.stdin.destroyed) {
                    shellProcess.stdin.write(str);
                }
            } catch (e) {}
        });

        ws.on('close', () => {
            try { shellProcess.kill(); } catch {}
        });

        ws.send(JSON.stringify({ type: 'ready', shell: shellCommand, cwd, mode: 'fallback-pty' }));

    } catch (e) {
        setupDumbShell(ws, shellCommand, cwd);
    }
}

/**
 * Last resort fallback: pipe-based shell (non-interactive, no PTY).
 */
function setupDumbShell(ws, shellCommand, cwd) {
    try {
        consoleStyler.log('system', `Dumb shell spawned: ${shellCommand}`);
        
        const args = [];
        if (shellCommand.endsWith('bash') || shellCommand.endsWith('zsh')) {
            args.push('-i');
        }

        const shellProcess = spawn(shellCommand, args, {
            cwd,
            env: { ...process.env, TERM: 'dumb', PS1: '$ ', PROMPT: '$ ' },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        shellProcess.stdout.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.stderr.on('data', (data) => {
            if (ws.readyState === 1) ws.send(data.toString());
        });

        shellProcess.on('exit', (code) => {
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'exit', exitCode: code }));
                ws.close();
            }
        });
        
        ws.on('message', (message) => {
            try {
                const str = message.toString();
                // Parse JSON control messages but forward everything else
                if (str.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(str);
                        if (parsed.type === 'resize') {
                            // Dumb shell doesn't support resize — ignore
                            return;
                        }
                    } catch {
                        // Not valid JSON — fall through to write as shell input
                    }
                }
                if (shellProcess.stdin) shellProcess.stdin.write(str);
            } catch (e) {}
        });

        ws.on('close', () => {
            try { shellProcess.kill(); } catch {}
        });

        ws.send(JSON.stringify({ type: 'ready', shell: shellCommand, cwd, mode: 'fallback-dumb' }));

    } catch (e) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message: `All shell spawn attempts failed: ${e.message}` }));
            ws.close();
        }
    }
}
