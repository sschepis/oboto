/**
 * Centralized path resolution for all Oboto data directories.
 *
 * Global data lives in `~/.oboto/` (user home).
 * Workspace-local data lives in `{workingDir}/.oboto/`.
 *
 * @module src/lib/paths
 */

import os from 'os';
import path from 'path';

/** Global config/data root: ~/.oboto/ */
export const GLOBAL_DIR = path.join(os.homedir(), '.oboto');

/* ──────────────────────────────────────────────────────────
 * Global paths (always under ~/.oboto/)
 * ────────────────────────────────────────────────────────── */

/** Global AI settings: ~/.oboto/ai-settings.json */
export const GLOBAL_AI_SETTINGS = path.join(GLOBAL_DIR, 'ai-settings.json');

/** Global setup state: ~/.oboto/setup.json */
export const GLOBAL_SETUP_FILE = path.join(GLOBAL_DIR, 'setup.json');

/** Global secrets vault: ~/.oboto/.secrets.enc */
export const GLOBAL_SECRETS_FILE = path.join(GLOBAL_DIR, '.secrets.enc');

/** Global MCP server config: ~/.oboto/mcp-servers.json */
export const GLOBAL_MCP_CONFIG = path.join(GLOBAL_DIR, 'mcp-servers.json');

/** Global installed plugins: ~/.oboto/plugins/ */
export const GLOBAL_PLUGINS_DIR = path.join(GLOBAL_DIR, 'plugins');

/** Global plugin data (storage + settings): ~/.oboto/plugins-data/ */
export const GLOBAL_PLUGINS_DATA_DIR = path.join(GLOBAL_DIR, 'plugins-data');

/** Global logs directory: ~/.oboto/logs/ */
export const GLOBAL_LOGS_DIR = path.join(GLOBAL_DIR, 'logs');

/** Global resolang memory: ~/.oboto/ (root — stores .memory.json etc.) */
export const GLOBAL_RESOLANG_DIR = GLOBAL_DIR;

/**
 * Return the global plugin-data directory for a specific plugin.
 * @param {string} pluginName
 * @returns {string} e.g. ~/.oboto/plugins-data/<pluginName>/
 */
export function globalPluginDataDir(pluginName) {
    return path.join(GLOBAL_PLUGINS_DATA_DIR, pluginName);
}

/* ──────────────────────────────────────────────────────────
 * Workspace-local paths (under {workingDir}/.oboto/)
 * These stay workspace-local — NOT moved to global.
 * ────────────────────────────────────────────────────────── */

/**
 * Return the workspace-local config root.
 * @param {string} workingDir
 * @returns {string} e.g. /path/to/project/.oboto/
 */
export function workspaceConfigDir(workingDir) {
    return path.join(workingDir, '.oboto');
}

/**
 * Return the workspace-local checkpoints directory.
 * @param {string} workingDir
 * @returns {string}
 */
export function workspaceCheckpointsDir(workingDir) {
    return path.join(workingDir, '.oboto', 'checkpoints');
}

/**
 * Return the workspace-local personas directory.
 * @param {string} workingDir
 * @returns {string}
 */
export function workspacePersonasDir(workingDir) {
    return path.join(workingDir, '.oboto', 'personas');
}

/**
 * Return the workspace-local schedules file.
 * @param {string} workingDir
 * @returns {string}
 */
export function workspaceSchedulesFile(workingDir) {
    return path.join(workingDir, '.oboto', 'schedules.json');
}

/**
 * Return the workspace-local MCP servers config.
 * @param {string} workingDir
 * @returns {string}
 */
export function workspaceMcpConfig(workingDir) {
    return path.join(workingDir, '.oboto', 'mcp-servers.json');
}
