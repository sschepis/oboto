/**
 * Output Presentation Layer (Layer 2)
 *
 * Sits between raw tool execution output (Layer 1) and the LLM context.
 * Implements four mechanisms from the *nix agent architecture:
 *
 *   A. Binary Guard — prevents binary data from polluting LLM context
 *   B. Overflow Mode — truncates large output with exploration hints
 *   C. Metadata Footer — appends [exit:N | Xms] for success/failure + cost awareness
 *   D. stderr Attachment — ensures failure reasons are always visible
 *
 * Design principle: Layer 1 (execution) stays raw and lossless for pipes.
 * Layer 2 (presentation) processes the *final* result before returning to the LLM.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Configuration ───────────────────────────────────────────────

const MAX_LINES = 200;
const MAX_BYTES = 50 * 1024; // 50KB
const CONTROL_CHAR_THRESHOLD = 0.10; // 10%

// Overflow workspace root — defaults to cwd, overridden by ToolExecutor
let _overflowWorkspaceRoot = process.cwd();

/**
 * Set the workspace root used for overflow file storage.
 * Called by ToolExecutor during initialization so overflow files
 * are stored inside the workspace (accessible to the VFS sandbox).
 * @param {string} root — absolute path to workspace root
 */
export function setOverflowWorkspaceRoot(root) {
    _overflowWorkspaceRoot = root;
}

/**
 * Get the overflow directory (inside workspace so agent can access it).
 * @returns {string}
 */
function getOverflowDir() {
    return path.join(_overflowWorkspaceRoot, '.ai-man', 'overflow');
}

// Counter for overflow files within this process
let overflowCounter = 0;

// ── Mechanism A: Binary Guard ───────────────────────────────────

/**
 * Detect if output is binary data that would corrupt LLM context.
 *
 * Checks for:
 * - Null bytes (definitive binary indicator)
 * - High ratio of control characters (>10%)
 *
 * @param {string} output — raw tool output
 * @returns {{ isBinary: boolean, type: string|null, sizeBytes: number }}
 */
export function detectBinary(output) {
    if (!output || typeof output !== 'string') {
        return { isBinary: false, type: null, sizeBytes: 0 };
    }

    const sizeBytes = Buffer.byteLength(output, 'utf8');

    // Check for null bytes — definitive binary
    if (output.includes('\0')) {
        const type = guessBinaryType(output);
        return { isBinary: true, type, sizeBytes };
    }

    // Check control character ratio (exclude common whitespace: \n \r \t)
    if (output.length > 100) { // Only check non-trivial output
        let controlCount = 0;
        const sample = output.substring(0, Math.min(output.length, 4096)); // Sample first 4KB
        for (let i = 0; i < sample.length; i++) {
            const code = sample.charCodeAt(i);
            if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
                controlCount++;
            }
        }
        const ratio = controlCount / sample.length;
        if (ratio > CONTROL_CHAR_THRESHOLD) {
            const type = guessBinaryType(output);
            return { isBinary: true, type, sizeBytes };
        }
    }

    return { isBinary: false, type: null, sizeBytes };
}

/**
 * Guess the binary file type from magic bytes or content patterns.
 * @param {string} output — raw output (may contain binary)
 * @returns {string} — human-readable type description
 */
function guessBinaryType(output) {
    const head = output.substring(0, 16);

    // PNG
    if (head.startsWith('\x89PNG')) return 'image (PNG)';
    // JPEG
    if (head.startsWith('\xFF\xD8\xFF')) return 'image (JPEG)';
    // GIF
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image (GIF)';
    // PDF
    if (head.startsWith('%PDF')) return 'PDF document';
    // ZIP/DOCX/XLSX
    if (head.startsWith('PK\x03\x04')) return 'archive (ZIP/Office)';
    // ELF
    if (head.startsWith('\x7FELF')) return 'executable (ELF)';
    // Mach-O
    if (head.startsWith('\xCF\xFA\xED\xFE') || head.startsWith('\xFE\xED\xFA\xCF')) return 'executable (Mach-O)';
    // WASM
    if (head.startsWith('\x00asm')) return 'WebAssembly module';

    return 'binary data';
}

/**
 * Format a binary detection result as an agent-friendly error message.
 *
 * @param {string} toolName — the tool that produced the output
 * @param {{ isBinary: boolean, type: string, sizeBytes: number }} detection
 * @param {string} [filePath] — if available, the file path that was read
 * @returns {string} — navigational error message
 */
export function formatBinaryError(toolName, detection, filePath) {
    const sizeStr = formatBytes(detection.sizeBytes);
    const typeName = detection.type || 'binary data';

    let suggestion = '';
    if (detection.type?.startsWith('image')) {
        suggestion = filePath
            ? `Use: run_command({ command: "file ${filePath}" }) to inspect metadata`
            : 'Use an image viewing tool to inspect this file';
    } else if (detection.type === 'PDF document') {
        suggestion = filePath
            ? `Use: run_command({ command: "pdftotext ${filePath} -" }) to extract text`
            : 'Convert the PDF to text before reading';
    } else {
        suggestion = filePath
            ? `Use: run_command({ command: "file ${filePath}" }) to identify the file type, or run_command({ command: "xxd ${filePath} | head" }) to inspect bytes`
            : 'Use file or xxd to inspect the binary content';
    }

    return `[error] ${toolName}: ${typeName} (${sizeStr}). ${suggestion}`;
}


// ── Mechanism B: Overflow Mode ──────────────────────────────────

/**
 * Truncate large output and save the full version to a temp file.
 * Returns the truncated output with exploration hints.
 *
 * @param {string} output — raw tool output
 * @returns {{ truncated: boolean, output: string, overflowPath: string|null }}
 */
export async function handleOverflow(output) {
    if (!output || typeof output !== 'string') {
        return { truncated: false, output: output || '', overflowPath: null };
    }

    const lines = output.split('\n');
    const byteLength = Buffer.byteLength(output, 'utf8');

    if (lines.length <= MAX_LINES && byteLength <= MAX_BYTES) {
        return { truncated: false, output, overflowPath: null };
    }

    // Truncate to MAX_LINES — rune-safe since we split on newlines
    const truncatedLines = lines.slice(0, MAX_LINES);
    const truncatedOutput = truncatedLines.join('\n');

    // Save full output to workspace-local overflow file (async)
    const overflowPath = await saveOverflowFile(output);

    // Use workspace-relative path so VFS sandbox can access it
    const relPath = path.relative(_overflowWorkspaceRoot, overflowPath);

    const totalLines = lines.length;
    const sizeStr = formatBytes(byteLength);

    const hint = [
        '',
        `--- output truncated (${totalLines} lines, ${sizeStr}) ---`,
        `Full output: ${relPath}`,
        `Explore: run({ command: "cat ${relPath} | grep <pattern>" })`,
        `         run({ command: "cat ${relPath} | tail -100" })`,
    ].join('\n');

    return {
        truncated: true,
        output: truncatedOutput + hint,
        overflowPath,
    };
}

/**
 * Save overflow content to a temporary file.
 * @param {string} content — full output
 * @returns {string} — path to the temp file
 */
async function saveOverflowFile(content) {
    const overflowDir = getOverflowDir();

    // Ensure overflow directory exists
    await fs.promises.mkdir(overflowDir, { recursive: true });

    overflowCounter++;
    const fileName = `cmd-${overflowCounter}-${Date.now()}.txt`;
    const filePath = path.join(overflowDir, fileName);

    try {
        await fs.promises.writeFile(filePath, content, 'utf8');
    } catch (e) {
        // If we can't write, return a placeholder
        return `${overflowDir}/${fileName} (write failed: ${e.message})`;
    }

    return filePath;
}


// ── Mechanism C: Metadata Footer ────────────────────────────────

/**
 * Format the metadata footer appended to every tool result.
 *
 * @param {{ exitCode?: number, durationMs: number, toolName?: string }} metadata
 * @returns {string}
 */
export function formatFooter(metadata) {
    const { exitCode, durationMs } = metadata;
    const durationStr = formatDuration(durationMs);

    if (exitCode !== undefined && exitCode !== null) {
        return `\n[exit:${exitCode} | ${durationStr}]`;
    }

    // For non-shell tools, use success/error indicator
    return `\n[ok | ${durationStr}]`;
}

/**
 * Format duration in human-readable form.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}


// ── Mechanism D: stderr Attachment ──────────────────────────────

/**
 * Attach stderr to the output when a command fails.
 * Ensures the agent can always see *why* something failed.
 *
 * @param {string} output — stdout or combined output
 * @param {string} stderr — stderr content
 * @param {number} exitCode — process exit code
 * @returns {string} — output with stderr attached if relevant
 */
export function attachStderr(output, stderr, exitCode) {
    if (!stderr || !stderr.trim()) return output;

    // Always attach stderr on failure (non-zero exit)
    if (exitCode !== 0) {
        return `${output}\n[stderr] ${stderr.trim()}`;
    }

    // On success, only attach stderr if it contains warnings
    if (stderr.toLowerCase().includes('warn') || stderr.toLowerCase().includes('deprecat')) {
        return `${output}\n[stderr:warning] ${stderr.trim()}`;
    }

    return output;
}


// ── Main Presentation Pipeline ──────────────────────────────────

/**
 * Process a raw tool result through the full presentation pipeline.
 * This is the main entry point called by ToolExecutor after execution.
 *
 * Pipeline:
 *   1. Binary guard — reject binary output
 *   2. Overflow mode — truncate large output
 *   3. Metadata footer — append timing and exit info
 *
 * @param {string} rawOutput — the raw tool result string
 * @param {{
 *   toolName: string,
 *   durationMs: number,
 *   exitCode?: number,
 *   stderr?: string,
 *   filePath?: string,
 *   skipPresentation?: boolean,
 * }} options
 * @returns {string} — processed output ready for LLM context
 */
export async function presentToolOutput(rawOutput, options = {}) {
    const {
        toolName = 'unknown',
        durationMs = 0,
        exitCode,
        stderr,
        filePath,
        skipPresentation = false,
    } = options;

    // Allow tools to opt out of presentation (e.g., structured JSON responses)
    if (skipPresentation) return rawOutput;

    let output = rawOutput || '';

    // ── Step 1: Binary Guard ──
    const binaryCheck = detectBinary(output);
    if (binaryCheck.isBinary) {
        const errorMsg = formatBinaryError(toolName, binaryCheck, filePath);
        return errorMsg + formatFooter({ exitCode: exitCode ?? 1, durationMs });
    }

    // ── Step 2: Overflow Mode (before stderr, so truncation doesn't hide errors) ──
    const overflow = await handleOverflow(output);
    output = overflow.output;

    // ── Step 3: stderr Attachment (after overflow, so agent always sees failure reasons) ──
    if (stderr) {
        output = attachStderr(output, stderr, exitCode ?? 0);
    }

    // ── Step 4: Metadata Footer ──
    output += formatFooter({ exitCode, durationMs, toolName });

    return output;
}


// ── Utilities ───────────────────────────────────────────────────

/**
 * Format bytes into human-readable size.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Clean up old overflow files (call periodically or on startup).
 * Removes files older than 1 hour.
 */
export function cleanupOverflowFiles() {
    const overflowDir = getOverflowDir();
    if (!fs.existsSync(overflowDir)) return;

    const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
    try {
        const files = fs.readdirSync(overflowDir);
        for (const file of files) {
            const filePath = path.join(overflowDir, file);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(filePath);
            }
        }
    } catch (e) {
        // Silently ignore cleanup errors
    }
}
