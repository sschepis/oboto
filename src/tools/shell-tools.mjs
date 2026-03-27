import { exec } from 'child_process';
import util from 'util';
import { attachStderr, formatFooter, handleOverflow, detectBinary, formatBinaryError } from '../execution/output-presenter.mjs';

const execPromise = util.promisify(exec);

// Blocked commands for safety
const BLOCKED_PATTERNS = [
    /\brm\s+-rf\s+[/~]/,   // rm -rf /  or rm -rf ~
    /\bsudo\b/,              // sudo
    /\b(mkfs|dd|fdisk)\b/,  // disk-destructive
    />\s*\/dev\/(?!null\b)/, // writing to devices (allow /dev/null)
];

/** Maximum timeout allowed for any shell command (10 minutes). */
const MAX_TIMEOUT = 600_000;

// Common command suggestions for recovery from failures
const COMMAND_SUGGESTIONS = {
    127: (cmd) => {
        const binary = cmd.split(/\s+/)[0];
        return `[error] run_command: command not found: ${binary}. ` +
            `Try: run_command({ command: "which ${binary}" }) to check if it's installed, ` +
            `or run_command({ command: "brew install ${binary}" }) / run_command({ command: "npm install -g ${binary}" }) to install it.`;
    },
    126: (cmd) => {
        const binary = cmd.split(/\s+/)[0];
        return `[error] run_command: permission denied: ${binary}. ` +
            `Try: run_command({ command: "chmod +x ${binary}" }) to make it executable.`;
    },
};

export class ShellTools {
    constructor(workingDir, options = {}) {
        this.workingDir = workingDir;
        this.allowList = options.allowList || null; // null = allow all (except blocked)
        this.denyList = options.denyList || BLOCKED_PATTERNS;
        this.timeout = Math.min(options.timeout || 30_000, MAX_TIMEOUT);
    }

    /**
     * Execute a shell command and return raw structured results (no presentation layer).
     * Used by CLI commands (exec/bash) which let CommandRouter handle presentation.
     *
     * @param {object} args
     * @param {string} args.command
     * @param {string} [args.cwd]
     * @param {number} [args.timeout]
     * @returns {Promise<{ output: string, exitCode: number }>}
     */
    async runCommandRaw(args) {
        const { command, cwd, timeout } = args;

        if (!command || typeof command !== 'string' || !command.trim()) {
            return { output: `[error] exec: "command" parameter is required. Usage: exec <command>`, exitCode: 1 };
        }

        const effectiveCwd = cwd || this.workingDir;
        const effectiveTimeout = Math.min(timeout || this.timeout, MAX_TIMEOUT);

        // Security check
        for (const pattern of this.denyList) {
            if (pattern.test(command)) {
                return {
                    output: `[error] exec: command blocked by security policy: ${command}. Blocked patterns include: sudo, rm -rf /, disk-destructive ops, writing to /dev/ (except /dev/null).`,
                    exitCode: 1,
                };
            }
        }

        if (this.allowList && !this.allowList.some(p => p.test(command))) {
            return { output: `[error] exec: command not in allowlist: ${command}`, exitCode: 1 };
        }

        try {
            const { stdout, stderr } = await execPromise(command, {
                cwd: effectiveCwd,
                timeout: effectiveTimeout,
                maxBuffer: 1024 * 1024 * 10,
            });

            let output = stdout || '';
            if (stderr && stderr.trim()) {
                output += (output ? '\n' : '') + stderr;
            }
            return { output, exitCode: 0 };
        } catch (error) {
            const exitCode = typeof error.code === 'number' ? error.code : (error.killed ? 137 : 1);
            const stderr = error.stderr || '';
            const stdout = error.stdout || '';
            let output = stdout;
            if (stderr) {
                output += (output ? '\n' : '') + stderr;
            } else if (error.message && !stdout) {
                output = error.message;
            }
            return { output, exitCode };
        }
    }

    async runCommand(args) {
        const { command, cwd, timeout } = args;
        const startTime = Date.now();

        // Validate required 'command' parameter
        if (!command || typeof command !== 'string' || !command.trim()) {
            return `[error] run_command: "command" parameter is required and must be a non-empty string. ` +
                `You called run_command with: ${JSON.stringify(args)}. ` +
                `Usage: run_command({ command: "ls -la" })`;
        }

        const effectiveCwd = cwd || this.workingDir;
        const effectiveTimeout = Math.min(timeout || this.timeout, MAX_TIMEOUT);

        // Security check
        for (const pattern of this.denyList) {
            if (pattern.test(command)) {
                const durationMs = Date.now() - startTime;
                return `[error] run_command: command blocked by security policy: ${command}. ` +
                    `Blocked patterns include: sudo, rm -rf /, disk-destructive ops, writing to /dev/ (except /dev/null).` +
                    formatFooter({ exitCode: 1, durationMs });
            }
        }

        if (this.allowList && !this.allowList.some(p => p.test(command))) {
            const durationMs = Date.now() - startTime;
            return `[error] run_command: command not in allowlist: ${command}` +
                formatFooter({ exitCode: 1, durationMs });
        }

        try {
            const { stdout, stderr } = await execPromise(command, {
                cwd: effectiveCwd,
                timeout: effectiveTimeout,
                maxBuffer: 1024 * 1024 * 10, // 10MB
            });

            const durationMs = Date.now() - startTime;

            // Build output: stdout is the primary output
            let output = stdout || '';

            // Binary guard — prevent binary output from corrupting LLM context
            const binaryCheck = detectBinary(output);
            if (binaryCheck.isBinary) {
                return formatBinaryError('run_command', binaryCheck) +
                    formatFooter({ exitCode: 0, durationMs });
            }

            // Overflow mode — truncate large output with exploration hints
            const overflow = handleOverflow(output);
            output = overflow.output;

            // Attach stderr if present (warnings on success, errors on failure)
            // After overflow so agent always sees stderr
            output = attachStderr(output, stderr, 0);

            // Append metadata footer
            output += formatFooter({ exitCode: 0, durationMs });

            return output;
        } catch (error) {
            const durationMs = Date.now() - startTime;
            const exitCode = typeof error.code === 'number' ? error.code : (error.killed ? 137 : 1);
            const stderr = error.stderr || '';
            const stdout = error.stdout || '';

            // Check for navigational suggestions based on exit code
            const suggestionFn = COMMAND_SUGGESTIONS[exitCode];
            if (suggestionFn && !stderr) {
                return suggestionFn(command) + formatFooter({ exitCode, durationMs });
            }

            // Build error output with stderr always visible
            let output = stdout;
            if (stderr) {
                output = attachStderr(output, stderr, exitCode);
            } else if (error.message && !stdout) {
                output = `[error] ${error.message}`;
            }

            output += formatFooter({ exitCode, durationMs });
            return output;
        }
    }
}
