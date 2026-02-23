/**
 * Tests for id-utils.mjs — ID generation utilities
 */

import { generateId, generateSimpleId, generateTempSuffix } from '../id-utils.mjs';

// ─── generateId ──────────────────────────────────────────────────────────

describe('generateId', () => {
    test('with no args uses "ITEM" prefix and matches format ITEM-<base36chars>', () => {
        const id = generateId();

        expect(id).toMatch(/^ITEM-[A-Z0-9]+$/);
    });

    test('uses custom prefix when provided', () => {
        const id = generateId('TASK');

        expect(id).toMatch(/^TASK-[A-Z0-9]+$/);
    });

    test('produces unique IDs on successive calls', () => {
        const ids = new Set(Array.from({ length: 20 }, () => generateId('X')));

        expect(ids.size).toBe(20);
    });
});

// ─── generateSimpleId ────────────────────────────────────────────────────

describe('generateSimpleId', () => {
    test('returns string with default "id" tag matching id_<timestamp>_<random>', () => {
        const id = generateSimpleId();

        expect(id).toMatch(/^id_\d+_[a-z0-9]+$/);
    });

    test('produces unique values on successive calls', () => {
        const ids = new Set(Array.from({ length: 20 }, () => generateSimpleId()));

        expect(ids.size).toBe(20);
    });
});

// ─── generateTempSuffix ──────────────────────────────────────────────────

describe('generateTempSuffix', () => {
    test('returns string matching <timestamp>-<random5chars>', () => {
        const suffix = generateTempSuffix();

        expect(suffix).toMatch(/^\d+-[a-z0-9]+$/);
    });
});
