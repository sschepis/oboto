import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

// Blocked commands for safety
const BLOCKED_PATTERNS = [
    /\brm\s+-rf\s+[/~]/,   // rm -rf /  or rm -rf ~
    /\bsudo\b/,              // sudo
    /\b(mkfs|dd|fdisk)\b/,  // disk-destructive
    />\s*\/dev\//,           // writing to devices
];

export class ShellTools {
    constructor(workingDir, options = {}) {
        this.workingDir = workingDir;
        this.allowList = options.allowList || null; // null = allow all (except blocked)
        this.denyList = options.denyList || BLOCKED_PATTERNS;
        this.timeout = options.timeout || 30_000;
    }

    async runCommand(args) {
        const { command, cwd, timeout } = args;
        const effectiveCwd = cwd || this.workingDir;
        const effectiveTimeout = timeout || this.timeout;

        // Security check
        for (const pattern of this.denyList) {
            if (pattern.test(command)) {
                return `Error: Command blocked by security policy: ${command}`;
            }
        }

        if (this.allowList && !this.allowList.some(p => p.test(command))) {
            return `Error: Command not in allowlist: ${command}`;
        }

        try {
            const { stdout, stderr } = await execPromise(command, {
                cwd: effectiveCwd,
                timeout: effectiveTimeout,
                maxBuffer: 1024 * 1024 * 10, // 10MB
            });
            return `STDOUT:\n${stdout}\n${stderr ? `STDERR:\n${stderr}` : ''}`;
        } catch (error) {
            return `Error (exit ${error.code}): ${error.stderr || error.message}`;
        }
    }
}
