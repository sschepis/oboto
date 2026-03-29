/**
 * Utilities for safely reading and writing .env files.
 * Preserves comments, blank lines, and formatting.
 * Uses the already-installed `dotenv` package for parsing.
 */

import fs from 'fs';
import path from 'path';

/**
 * Upsert a key=value pair into a .env file.
 * - If the key already exists, its value is replaced in-place.
 * - If the key does not exist, a new line is appended.
 * - If the file does not exist, it is created with a header comment.
 * - Comments, blank lines, and ordering are preserved.
 *
 * @param {string} envPath - Absolute path to the .env file
 * @param {string} key    - The environment variable name (e.g. OPENAI_API_KEY)
 * @param {string} value  - The value to set
 */
export function upsertEnvFile(envPath, key, value) {
    let content = '';
    try {
        content = fs.readFileSync(envPath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        // File doesn't exist — create with header
        content = '# Environment variables\n# This file is auto-managed. Do not commit to version control.\n\n';
    }

    // Escape the value if it contains spaces, quotes, or the # character
    const escapedValue = escapeEnvValue(value);

    // Try to replace an existing line for this key.
    // Match lines like:  KEY=value  or  KEY="value"  or  KEY=  (empty)
    // but NOT commented-out lines (# KEY=value).
    const regex = new RegExp(`^(${escapeRegExp(key)})\\s*=.*$`, 'm');

    if (regex.test(content)) {
        content = content.replace(regex, `${key}=${escapedValue}`);
    } else {
        // Append — ensure there's a newline before the new entry
        if (!content.endsWith('\n')) {
            content += '\n';
        }
        content += `${key}=${escapedValue}\n`;
    }

    // Ensure the directory exists
    const dir = path.dirname(envPath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(envPath, content, { mode: 0o600 });
}

/**
 * Read all key-value pairs from a .env file.
 * Returns an object. Comments and blank lines are ignored.
 *
 * @param {string} envPath - Absolute path to the .env file
 * @returns {Record<string, string>}
 */
export function readEnvFile(envPath) {
    const result = {};
    let content;
    try {
        content = fs.readFileSync(envPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return result;
        throw err;
    }

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();

        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        result[key] = value;
    }

    return result;
}

/**
 * Escape a value for safe inclusion in a .env file.
 * Wraps in double quotes if the value contains spaces, #, ", or newlines.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeEnvValue(value) {
    // If value contains characters that need quoting
    if (/[\s#"'\\]/.test(value) || value === '') {
        // Escape backslashes and double quotes inside the value
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `"${escaped}"`;
    }
    return value;
}

/**
 * Escape a string for use in a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
