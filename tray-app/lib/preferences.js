/**
 * Preferences manager for Oboto tray app.
 *
 * Persists configuration to ~/.oboto/preferences.json
 * using electron-store (or a plain JSON fallback when running outside Electron).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./logger');

const PREFS_DIR = path.join(os.homedir(), '.oboto');
const PREFS_FILE = path.join(PREFS_DIR, 'preferences.json');

const DEFAULTS = {
    currentWorkspace: null,
    recentWorkspaces: [],
    port: 3000,
    autoStart: false,
    autoActivateOnStart: true,
    openBrowserOnLoad: true,
    maxRecentWorkspaces: 5,
};

class Preferences {
    constructor() {
        this._data = { ...DEFAULTS };
        this._load();
    }

    // ── Getters ──────────────────────────────────────────────────

    get(key) {
        return this._data[key];
    }

    getAll() {
        return { ...this._data };
    }

    // ── Setters ──────────────────────────────────────────────────

    set(key, value) {
        this._data[key] = value;
        this._save();
    }

    // ── Workspace helpers ────────────────────────────────────────

    /**
     * Set the current workspace and add it to the recent list.
     * @param {string} workspacePath – absolute path to the workspace directory
     */
    setCurrentWorkspace(workspacePath) {
        this._data.currentWorkspace = workspacePath;

        // Add to recent list (move to front if already present)
        const recents = this._data.recentWorkspaces.filter(p => p !== workspacePath);
        recents.unshift(workspacePath);
        this._data.recentWorkspaces = recents.slice(0, this._data.maxRecentWorkspaces);

        this._save();
    }

    /**
     * Get the list of recent workspace paths.
     * @returns {string[]}
     */
    getRecentWorkspaces() {
        return [...this._data.recentWorkspaces];
    }

    /**
     * Remove a workspace from the recent list.
     */
    removeRecentWorkspace(workspacePath) {
        this._data.recentWorkspaces = this._data.recentWorkspaces.filter(p => p !== workspacePath);
        if (this._data.currentWorkspace === workspacePath) {
            this._data.currentWorkspace = null;
        }
        this._save();
    }

    // ── Persistence ──────────────────────────────────────────────

    _load() {
        try {
            if (!fs.existsSync(PREFS_DIR)) {
                fs.mkdirSync(PREFS_DIR, { recursive: true });
            }
            if (fs.existsSync(PREFS_FILE)) {
                const raw = fs.readFileSync(PREFS_FILE, 'utf8');
                const parsed = JSON.parse(raw);
                this._data = { ...DEFAULTS, ...parsed };
            }
        } catch (err) {
            logger.error('Preferences', 'Failed to load:', err.message);
        }
    }

    _save() {
        try {
            if (!fs.existsSync(PREFS_DIR)) {
                fs.mkdirSync(PREFS_DIR, { recursive: true });
            }
            fs.writeFileSync(PREFS_FILE, JSON.stringify(this._data, null, 2), 'utf8');
        } catch (err) {
            logger.error('Preferences', 'Failed to save:', err.message);
        }
    }
}

module.exports = { Preferences };
