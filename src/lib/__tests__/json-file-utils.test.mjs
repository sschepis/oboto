/**
 * Tests for json-file-utils.mjs — JSON file read/write utilities
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    readJsonFileSync,
    readJsonFile,
    writeJsonFileSync,
    writeJsonFile,
} from '../json-file-utils.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────

const tmpFiles = [];

function tmpPath(name) {
    const p = path.join(os.tmpdir(), `json-file-utils-test-${Date.now()}-${name}`);
    tmpFiles.push(p);
    return p;
}

afterEach(() => {
    for (const f of tmpFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
});

// ─── readJsonFileSync ────────────────────────────────────────────────────

describe('readJsonFileSync', () => {
    test('returns parsed object from valid JSON file', () => {
        const filePath = tmpPath('valid.json');
        fs.writeFileSync(filePath, JSON.stringify({ hello: 'world', n: 42 }));

        const result = readJsonFileSync(filePath);

        expect(result).toEqual({ hello: 'world', n: 42 });
    });

    test('returns null for non-existent file', () => {
        const result = readJsonFileSync('/tmp/does-not-exist-xyz-987654.json');

        expect(result).toBeNull();
    });

    test('returns null for invalid JSON content', () => {
        const filePath = tmpPath('invalid.json');
        fs.writeFileSync(filePath, '{ broken json !!!');

        const result = readJsonFileSync(filePath);

        expect(result).toBeNull();
    });
});

// ─── readJsonFile (async) ────────────────────────────────────────────────

describe('readJsonFile', () => {
    test('returns parsed object from valid JSON file', async () => {
        const filePath = tmpPath('async-valid.json');
        fs.writeFileSync(filePath, JSON.stringify({ async: true, items: [1, 2, 3] }));

        const result = await readJsonFile(filePath);

        expect(result).toEqual({ async: true, items: [1, 2, 3] });
    });

    test('returns null for non-existent file', async () => {
        const result = await readJsonFile('/tmp/does-not-exist-async-xyz-987654.json');

        expect(result).toBeNull();
    });
});

// ─── writeJsonFileSync ───────────────────────────────────────────────────

describe('writeJsonFileSync', () => {
    test('writes JSON with 2-space indent and can be read back', () => {
        const filePath = tmpPath('write-sync.json');
        const data = { name: 'test', values: [1, 2, 3] };

        writeJsonFileSync(filePath, data);

        const raw = fs.readFileSync(filePath, 'utf8');
        expect(raw).toBe(JSON.stringify(data, null, 2));
        expect(JSON.parse(raw)).toEqual(data);
    });

    test('throws on write error (e.g. non-existent parent directory)', () => {
        const badPath = path.join(os.tmpdir(), 'nonexistent-dir-xyz-99', 'sub', 'file.json');

        expect(() => writeJsonFileSync(badPath, { a: 1 })).toThrow();
    });
});

// ─── writeJsonFile (async) ───────────────────────────────────────────────

describe('writeJsonFile', () => {
    test('writes JSON and can be read back', async () => {
        const filePath = tmpPath('write-async.json');
        const data = { key: 'async-value', nested: { ok: true } };

        await writeJsonFile(filePath, data);

        const result = await readJsonFile(filePath);
        expect(result).toEqual(data);
    });
});
