/**
 * Tests for output-presenter.mjs — Presentation Layer (Layer 2)
 *
 * Tests all four mechanisms:
 *   A. Binary Guard (detectBinary, formatBinaryError)
 *   B. Overflow Mode (handleOverflow)
 *   C. Metadata Footer (formatFooter)
 *   D. stderr Attachment (attachStderr)
 *   + Full pipeline (presentToolOutput)
 *   + Utilities (formatBytes, cleanupOverflowFiles)
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    detectBinary,
    formatBinaryError,
    handleOverflow,
    formatFooter,
    attachStderr,
    presentToolOutput,
    formatBytes,
    cleanupOverflowFiles,
    setOverflowWorkspaceRoot,
} from '../output-presenter.mjs';

const TEST_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-man-output-presenter-'));
const OVERFLOW_DIR = path.join(TEST_WORKSPACE_ROOT, '.ai-man', 'overflow');

beforeAll(() => {
    setOverflowWorkspaceRoot(TEST_WORKSPACE_ROOT);
});

afterAll(() => {
    setOverflowWorkspaceRoot(process.cwd());
    fs.rmSync(TEST_WORKSPACE_ROOT, { recursive: true, force: true });
});

// ─── Mechanism A: Binary Guard ──────────────────────────────────────────

describe('detectBinary()', () => {
    test('returns isBinary=false for normal text', () => {
        const result = detectBinary('Hello, world!\nThis is normal text.');
        expect(result.isBinary).toBe(false);
        expect(result.type).toBeNull();
    });

    test('returns isBinary=false for empty/null/undefined input', () => {
        expect(detectBinary('')).toEqual({ isBinary: false, type: null, sizeBytes: 0 });
        expect(detectBinary(null)).toEqual({ isBinary: false, type: null, sizeBytes: 0 });
        expect(detectBinary(undefined)).toEqual({ isBinary: false, type: null, sizeBytes: 0 });
    });

    test('detects binary via null bytes', () => {
        const binary = 'some\0binary\0data';
        const result = detectBinary(binary);
        expect(result.isBinary).toBe(true);
        expect(result.sizeBytes).toBeGreaterThan(0);
    });

    test('detects PNG magic bytes', () => {
        const png = '\x89PNG\r\n\x1a\n' + '\0'.repeat(100);
        const result = detectBinary(png);
        expect(result.isBinary).toBe(true);
        expect(result.type).toBe('image (PNG)');
    });

    test('detects JPEG magic bytes', () => {
        const jpeg = '\xFF\xD8\xFF\xE0' + '\0'.repeat(100);
        const result = detectBinary(jpeg);
        expect(result.isBinary).toBe(true);
        expect(result.type).toBe('image (JPEG)');
    });

    test('detects GIF magic bytes', () => {
        const gif87 = 'GIF87a' + '\0'.repeat(100);
        const gif89 = 'GIF89a' + '\0'.repeat(100);
        expect(detectBinary(gif87).type).toBe('image (GIF)');
        expect(detectBinary(gif89).type).toBe('image (GIF)');
    });

    test('detects PDF magic bytes', () => {
        const pdf = '%PDF-1.4' + '\0'.repeat(100);
        const result = detectBinary(pdf);
        expect(result.isBinary).toBe(true);
        expect(result.type).toBe('PDF document');
    });

    test('detects ZIP/Office magic bytes', () => {
        const zip = 'PK\x03\x04' + '\0'.repeat(100);
        const result = detectBinary(zip);
        expect(result.isBinary).toBe(true);
        expect(result.type).toBe('archive (ZIP/Office)');
    });

    test('detects ELF executable', () => {
        const elf = '\x7FELF' + '\0'.repeat(100);
        const result = detectBinary(elf);
        expect(result.isBinary).toBe(true);
        expect(result.type).toBe('executable (ELF)');
    });

    test('detects high control-character ratio as binary', () => {
        // Build a string > 100 chars with > 10% control chars (using char code 1)
        const controlChar = String.fromCharCode(1);
        const text = controlChar.repeat(50) + 'a'.repeat(100);
        const result = detectBinary(text);
        expect(result.isBinary).toBe(true);
        expect(result.type).toBe('binary data');
    });

    test('does not falsely detect text with normal whitespace', () => {
        // Tabs, newlines, carriage returns should NOT count as control chars
        const text = 'line1\n\tindented\r\nline3\n' + 'x'.repeat(200);
        const result = detectBinary(text);
        expect(result.isBinary).toBe(false);
    });

    test('does not check control ratio for short strings (<= 100 chars)', () => {
        // Even with high control ratio, short strings pass
        const text = String.fromCharCode(1).repeat(50);
        const result = detectBinary(text);
        // Has null? No (char code 1 is not null)
        // Too short for control char check
        expect(result.isBinary).toBe(false);
    });

    test('reports accurate sizeBytes', () => {
        const text = 'hello 🌍'; // emoji is 4 bytes in UTF-8
        const result = detectBinary(text);
        expect(result.sizeBytes).toBe(Buffer.byteLength(text, 'utf8'));
    });
});

// ─── formatBinaryError ──────────────────────────────────────────────────

describe('formatBinaryError()', () => {
    test('formats image error with file path suggestion', () => {
        const detection = { isBinary: true, type: 'image (PNG)', sizeBytes: 182000 };
        const msg = formatBinaryError('read_file', detection, 'screenshot.png');
        expect(msg).toContain('[error] read_file:');
        expect(msg).toContain('image (PNG)');
        expect(msg).toContain('177.7KB');
        expect(msg).toContain('file screenshot.png');
    });

    test('formats image error without file path', () => {
        const detection = { isBinary: true, type: 'image (JPEG)', sizeBytes: 50000 };
        const msg = formatBinaryError('run_command', detection);
        expect(msg).toContain('[error] run_command:');
        expect(msg).toContain('image viewing tool');
    });

    test('formats PDF error with pdftotext suggestion', () => {
        const detection = { isBinary: true, type: 'PDF document', sizeBytes: 1200000 };
        const msg = formatBinaryError('cat', detection, 'report.pdf');
        expect(msg).toContain('PDF document');
        expect(msg).toContain('pdftotext report.pdf');
    });

    test('formats generic binary error with xxd suggestion', () => {
        const detection = { isBinary: true, type: 'binary data', sizeBytes: 4096 };
        const msg = formatBinaryError('read_file', detection, 'data.bin');
        expect(msg).toContain('binary data');
        expect(msg).toContain('xxd data.bin');
    });

    test('handles null type gracefully', () => {
        const detection = { isBinary: true, type: null, sizeBytes: 100 };
        const msg = formatBinaryError('tool', detection, 'file.dat');
        expect(msg).toContain('binary data');
    });
});

// ─── Mechanism B: Overflow Mode ─────────────────────────────────────────

describe('handleOverflow()', () => {
    test('returns original output when under limits', async () => {
        const output = 'line1\nline2\nline3';
        const result = await handleOverflow(output);
        expect(result.truncated).toBe(false);
        expect(result.output).toBe(output);
        expect(result.overflowPath).toBeNull();
    });

    test('handles null/empty/non-string input', async () => {
        expect(await handleOverflow(null)).toEqual({ truncated: false, output: '', overflowPath: null });
        expect(await handleOverflow('')).toEqual({ truncated: false, output: '', overflowPath: null });
        expect(await handleOverflow(undefined)).toEqual({ truncated: false, output: '', overflowPath: null });
    });

    test('truncates output exceeding MAX_LINES (200)', async () => {
        const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
        const output = lines.join('\n');
        const result = await handleOverflow(output);

        expect(result.truncated).toBe(true);
        expect(result.overflowPath).toBeTruthy();

        // Should contain first 200 lines
        const resultLines = result.output.split('\n');
        expect(resultLines[0]).toBe('line 1');
        expect(resultLines[199]).toBe('line 200');

        // Should contain truncation metadata
        expect(result.output).toContain('--- output truncated (300 lines');
        expect(result.output).toContain('Full output:');
        expect(result.output).toContain('grep <pattern>');
        expect(result.output).toContain('tail -100');

        // Cleanup
        if (result.overflowPath && fs.existsSync(result.overflowPath)) {
            fs.unlinkSync(result.overflowPath);
        }
    });

    test('truncates output exceeding MAX_BYTES (50KB)', async () => {
        // Create output under 200 lines but over 50KB
        const bigLine = 'x'.repeat(1024); // 1KB per line
        const lines = Array.from({ length: 60 }, () => bigLine);
        const output = lines.join('\n'); // ~60KB, 60 lines
        const result = await handleOverflow(output);

        expect(result.truncated).toBe(true);
        expect(result.overflowPath).toBeTruthy();

        // Cleanup
        if (result.overflowPath && fs.existsSync(result.overflowPath)) {
            fs.unlinkSync(result.overflowPath);
        }
    });

    test('saves full output to overflow file', async () => {
        const lines = Array.from({ length: 250 }, (_, i) => `data-${i}`);
        const output = lines.join('\n');
        const result = await handleOverflow(output);

        expect(result.overflowPath).toBeTruthy();
        expect(fs.existsSync(result.overflowPath)).toBe(true);

        const savedContent = fs.readFileSync(result.overflowPath, 'utf8');
        expect(savedContent).toBe(output);

        // Cleanup
        fs.unlinkSync(result.overflowPath);
    });
});

// ─── Mechanism C: Metadata Footer ───────────────────────────────────────

describe('formatFooter()', () => {
    test('formats with exit code and duration in ms', () => {
        const footer = formatFooter({ exitCode: 0, durationMs: 45 });
        expect(footer).toBe('\n[exit:0 | 45ms]');
    });

    test('formats with non-zero exit code', () => {
        const footer = formatFooter({ exitCode: 127, durationMs: 100 });
        expect(footer).toBe('\n[exit:127 | 100ms]');
    });

    test('formats duration in seconds when >= 1000ms', () => {
        const footer = formatFooter({ exitCode: 0, durationMs: 3200 });
        expect(footer).toBe('\n[exit:0 | 3.2s]');
    });

    test('formats duration in minutes when >= 60000ms', () => {
        const footer = formatFooter({ exitCode: 0, durationMs: 90000 });
        expect(footer).toBe('\n[exit:0 | 1.5m]');
    });

    test('formats without exit code as [ok | ...]', () => {
        const footer = formatFooter({ durationMs: 12 });
        expect(footer).toBe('\n[ok | 12ms]');
    });

    test('handles exitCode=0 (falsy but defined)', () => {
        const footer = formatFooter({ exitCode: 0, durationMs: 5 });
        expect(footer).toContain('exit:0');
    });

    test('handles undefined exitCode', () => {
        const footer = formatFooter({ exitCode: undefined, durationMs: 10 });
        expect(footer).toBe('\n[ok | 10ms]');
    });

    test('handles null exitCode', () => {
        const footer = formatFooter({ exitCode: null, durationMs: 10 });
        expect(footer).toBe('\n[ok | 10ms]');
    });
});

// ─── Mechanism D: stderr Attachment ─────────────────────────────────────

describe('attachStderr()', () => {
    test('attaches stderr on failure (non-zero exit)', () => {
        const result = attachStderr('output', 'command not found', 127);
        expect(result).toBe('output\n[stderr] command not found');
    });

    test('attaches stderr on exitCode=1', () => {
        const result = attachStderr('', 'error details', 1);
        expect(result).toBe('\n[stderr] error details');
    });

    test('does not attach empty stderr', () => {
        const result = attachStderr('output', '', 1);
        expect(result).toBe('output');
    });

    test('does not attach whitespace-only stderr', () => {
        const result = attachStderr('output', '   \n  ', 0);
        expect(result).toBe('output');
    });

    test('does not attach null/undefined stderr', () => {
        expect(attachStderr('output', null, 1)).toBe('output');
        expect(attachStderr('output', undefined, 0)).toBe('output');
    });

    test('on success, attaches warnings from stderr', () => {
        const result = attachStderr('build complete', 'WARNING: deprecated API', 0);
        expect(result).toBe('build complete\n[stderr:warning] WARNING: deprecated API');
    });

    test('on success, attaches deprecation notices from stderr', () => {
        const result = attachStderr('done', 'DeprecationWarning: use X instead', 0);
        expect(result).toBe('done\n[stderr:warning] DeprecationWarning: use X instead');
    });

    test('on success, does not attach non-warning stderr', () => {
        const result = attachStderr('output', 'some informational message', 0);
        expect(result).toBe('output');
    });

    test('trims stderr content', () => {
        const result = attachStderr('out', '  error msg  \n  ', 1);
        expect(result).toBe('out\n[stderr] error msg');
    });
});

// ─── Full Pipeline: presentToolOutput ───────────────────────────────────

describe('presentToolOutput()', () => {
    test('passes through with skipPresentation=true', async () => {
        const raw = '{"structured": "json"}';
        const result = await presentToolOutput(raw, { skipPresentation: true });
        expect(result).toBe(raw);
    });

    test('appends metadata footer to normal output', async () => {
        const result = await presentToolOutput('hello world', {
            toolName: 'read_file',
            durationMs: 25,
        });
        expect(result).toBe('hello world\n[ok | 25ms]');
    });

    test('appends exit code footer for shell tools', async () => {
        const result = await presentToolOutput('file list', {
            toolName: 'run_command',
            durationMs: 100,
            exitCode: 0,
        });
        expect(result).toBe('file list\n[exit:0 | 100ms]');
    });

    test('rejects binary output with navigational error', async () => {
        const binary = '\x89PNG\r\n\x1a\n' + '\0'.repeat(200);
        const result = await presentToolOutput(binary, {
            toolName: 'read_file',
            durationMs: 15,
            filePath: 'image.png',
        });
        expect(result).toContain('[error] read_file:');
        expect(result).toContain('image (PNG)');
        expect(result).toContain('[exit:1 | 15ms]');
    });

    test('attaches stderr before overflow processing', async () => {
        const result = await presentToolOutput('partial output', {
            toolName: 'run_command',
            durationMs: 500,
            exitCode: 1,
            stderr: 'file not found',
        });
        expect(result).toContain('[stderr] file not found');
        expect(result).toContain('[exit:1 | 500ms]');
    });

    test('truncates large output and adds overflow hints', async () => {
        const lines = Array.from({ length: 300 }, (_, i) => `log line ${i}`);
        const output = lines.join('\n');
        const result = await presentToolOutput(output, {
            toolName: 'run_command',
            durationMs: 2000,
            exitCode: 0,
        });

        expect(result).toContain('log line 0');
        expect(result).toContain('log line 199');
        expect(result).toContain('--- output truncated');
        expect(result).toContain('[exit:0 | 2.0s]');

        // Cleanup overflow file
        const match = result.match(/Full output: (.+)/);
        if (match && match[1] && fs.existsSync(match[1])) {
            fs.unlinkSync(match[1]);
        }
    });

    test('handles null/empty raw output', async () => {
        const result = await presentToolOutput(null, {
            toolName: 'test',
            durationMs: 5,
        });
        expect(result).toBe('\n[ok | 5ms]');
    });

    test('handles empty string output', async () => {
        const result = await presentToolOutput('', {
            toolName: 'test',
            durationMs: 5,
        });
        expect(result).toBe('\n[ok | 5ms]');
    });

    test('binary guard assigns exitCode=1 when no exitCode provided', async () => {
        const binary = '\x89PNG\r\n\x1a\n' + '\0'.repeat(100);
        const result = await presentToolOutput(binary, {
            toolName: 'cat',
            durationMs: 10,
        });
        expect(result).toContain('[exit:1 | 10ms]');
    });

    test('full pipeline: stderr + overflow + footer all work together', async () => {
        const lines = Array.from({ length: 250 }, (_, i) => `data ${i}`);
        const output = lines.join('\n');
        const result = await presentToolOutput(output, {
            toolName: 'run_command',
            durationMs: 3500,
            exitCode: 1,
            stderr: 'partial failure',
        });

        // stderr should be attached
        expect(result).toContain('[stderr] partial failure');
        // Should be truncated
        expect(result).toContain('--- output truncated');
        // Footer should be present
        expect(result).toContain('[exit:1 | 3.5s]');

        // Cleanup overflow file
        const match = result.match(/Full output: (.+)/);
        if (match && match[1] && fs.existsSync(match[1])) {
            fs.unlinkSync(match[1]);
        }
    });
});

// ─── Utilities ──────────────────────────────────────────────────────────

describe('formatBytes()', () => {
    test('formats bytes', () => {
        expect(formatBytes(500)).toBe('500B');
    });

    test('formats kilobytes', () => {
        expect(formatBytes(1024)).toBe('1.0KB');
        expect(formatBytes(51200)).toBe('50.0KB');
    });

    test('formats megabytes', () => {
        expect(formatBytes(1048576)).toBe('1.0MB');
        expect(formatBytes(5242880)).toBe('5.0MB');
    });

    test('formats zero bytes', () => {
        expect(formatBytes(0)).toBe('0B');
    });
});

describe('cleanupOverflowFiles()', () => {
    test('does not throw when overflow directory does not exist', () => {
        // Temporarily rename if exists
        const backupDir = OVERFLOW_DIR + '-test-backup';
        const dirExists = fs.existsSync(OVERFLOW_DIR);
        if (dirExists) {
            fs.renameSync(OVERFLOW_DIR, backupDir);
        }

        expect(() => cleanupOverflowFiles()).not.toThrow();

        // Restore
        if (dirExists) {
            fs.renameSync(backupDir, OVERFLOW_DIR);
        }
    });

    test('removes old files but keeps recent ones', () => {
        // Ensure directory exists
        if (!fs.existsSync(OVERFLOW_DIR)) {
            fs.mkdirSync(OVERFLOW_DIR, { recursive: true });
        }

        // Create an "old" file (modify mtime to 2 hours ago)
        const oldFile = path.join(OVERFLOW_DIR, 'test-old-cleanup.txt');
        fs.writeFileSync(oldFile, 'old content');
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        fs.utimesSync(oldFile, twoHoursAgo, twoHoursAgo);

        // Create a "recent" file
        const recentFile = path.join(OVERFLOW_DIR, 'test-recent-cleanup.txt');
        fs.writeFileSync(recentFile, 'recent content');

        cleanupOverflowFiles();

        // Old file should be removed
        expect(fs.existsSync(oldFile)).toBe(false);
        // Recent file should remain
        expect(fs.existsSync(recentFile)).toBe(true);

        // Cleanup
        if (fs.existsSync(recentFile)) {
            fs.unlinkSync(recentFile);
        }
    });
});
