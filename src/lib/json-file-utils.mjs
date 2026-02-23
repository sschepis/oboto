// Shared JSON file read/write utilities
// Consolidated from 17+ inline JSON.parse(fs.readFileSync(...)) patterns
// See docs/DUPLICATE_CODE_ANALYSIS.md — OPT-3

import fs from 'node:fs';

/**
 * Read and parse a JSON file synchronously.
 * Returns `fallback` if the file doesn't exist or is invalid JSON.
 *
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @param {*} [fallback=null] - Value to return on failure
 * @returns {*} Parsed JSON data, or `fallback` on error
 */
export function readJsonFileSync(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

/**
 * Read and parse a JSON file asynchronously.
 * Returns `fallback` if the file doesn't exist or is invalid JSON.
 *
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @param {*} [fallback=null] - Value to return on failure
 * @returns {Promise<*>} Parsed JSON data, or `fallback` on error
 */
export async function readJsonFile(filePath, fallback = null) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch {
        return fallback;
    }
}

/**
 * Write a value to a JSON file synchronously with pretty-printing.
 *
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @param {*} data - Data to serialize
 * @param {number} [indent=2] - JSON indentation spaces
 */
export function writeJsonFileSync(filePath, data, indent = 2) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, indent), 'utf8');
}

/**
 * Write a value to a JSON file asynchronously with pretty-printing.
 *
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @param {*} data - Data to serialize
 * @param {number} [indent=2] - JSON indentation spaces
 */
export async function writeJsonFile(filePath, data, indent = 2) {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, indent), 'utf8');
}
