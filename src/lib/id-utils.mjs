// Shared ID generation utilities
// Consolidated from 12+ copy-pasted patterns across the codebase
// See docs/DUPLICATE_CODE_ANALYSIS.md — DUP-7

/**
 * Generate a unique ID with a given prefix.
 * Format: `PREFIX-<timestamp36><random4>` (uppercased)
 *
 * @param {string} [prefix='ITEM'] - ID prefix (e.g., 'FEAT', 'TASK', 'INV', 'PROJ')
 * @returns {string} Generated ID
 *
 * @example
 *   generateId('FEAT')  // => 'FEAT-M1ABC2XY'
 *   generateId('TASK')  // => 'TASK-M1ABC3QR'
 */
export function generateId(prefix = 'ITEM') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `${prefix}-${timestamp}${random}`.toUpperCase();
}

/**
 * Generate a simple unique string (no prefix, lower case).
 * Useful for internal IDs like call IDs, request IDs, etc.
 *
 * @param {string} [tag='id'] - Optional tag prefix (e.g., 'call', 'req', 'schedule')
 * @returns {string} Generated ID like 'call_1708123456789_abc123def'
 */
export function generateSimpleId(tag = 'id') {
    return `${tag}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a safe temporary filename suffix.
 * Useful for atomic file writes (write to temp, then rename).
 *
 * @returns {string} Suffix like '1708123456789-abc12'
 */
export function generateTempSuffix() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}
