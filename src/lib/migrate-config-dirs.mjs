/**
 * One-time migration: .ai-man → .oboto, ~/.ai-man → ~/.oboto,
 * ~/.oboto-service → ~/.oboto, and project-root .secrets.enc → ~/.oboto/
 *
 * Moves workspace-local config from .ai-man/ to .oboto/,
 * global config from ~/.ai-man/ and ~/.oboto-service/ to ~/.oboto/,
 * and legacy project-root .secrets.enc to ~/.oboto/.secrets.enc.
 *
 * Safe to call on every startup — it's a no-op once the old directories
 * and files are gone (or were never present).
 *
 * @module lib/migrate-config-dirs
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const OLD_WORKSPACE_DIR = '.ai-man';
const NEW_WORKSPACE_DIR = '.oboto';

const OLD_GLOBAL_AI_MAN = path.join(os.homedir(), '.ai-man');
const OLD_GLOBAL_DIR = path.join(os.homedir(), '.oboto-service');
const NEW_GLOBAL_DIR = path.join(os.homedir(), '.oboto');

/**
 * Recursively copy contents from `src` into `dest`, skipping files that
 * already exist in `dest` (existing data wins).
 * @param {string} src
 * @param {string} dest
 */
function mergeDirs(src, dest) {
    if (!fs.existsSync(src)) return;

    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Skip symlinks to avoid following links to external trees or
        // circular references that could cause infinite recursion.
        if (entry.isSymbolicLink()) {
            continue;
        }

        if (entry.isDirectory()) {
            mergeDirs(srcPath, destPath);
        } else if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Safely rename (mark as migrated). Handles EXDEV errors when source and
 * destination are on different filesystems (e.g. symlinked workspaces).
 * @param {string} oldPath
 * @param {string} newPath
 */
function safeRename(oldPath, newPath) {
    try {
        fs.renameSync(oldPath, newPath);
    } catch (err) {
        if (err.code === 'EXDEV') {
            // Cross-device rename not supported — contents already copied,
            // leave the old directory in place rather than crashing.
            console.warn(`[migrate] Cannot rename across devices; old path preserved: ${oldPath}`);
        } else {
            throw err;
        }
    }
}

/**
 * Migrate workspace-local config directory from .ai-man/ → .oboto/.
 * @param {string} workspaceDir — absolute path to the workspace root
 * @returns {boolean} true if migration was performed
 */
export function migrateWorkspaceConfig(workspaceDir) {
    if (!workspaceDir) return false;

    const oldDir = path.join(workspaceDir, OLD_WORKSPACE_DIR);
    const newDir = path.join(workspaceDir, NEW_WORKSPACE_DIR);

    if (!fs.existsSync(oldDir)) return false;

    try {
        mergeDirs(oldDir, newDir);
        // Rename old dir so we don't migrate twice
        safeRename(oldDir, oldDir + '.migrated');
        console.log(`[migrate] Moved workspace config ${oldDir} → ${newDir}`);
        return true;
    } catch (err) {
        console.warn(`[migrate] Failed to migrate workspace config: ${err.message}`);
        return false;
    }
}

/**
 * Migrate global config directories to ~/.oboto/.
 * Handles two legacy locations:
 *   1. ~/.ai-man/  (resolang global memory)
 *   2. ~/.oboto-service/  (tray-app preferences)
 * @returns {boolean} true if any migration was performed
 */
export function migrateGlobalConfig() {
    let migrated = false;

    // 1. ~/.ai-man → ~/.oboto (resolang global memory, etc.)
    if (fs.existsSync(OLD_GLOBAL_AI_MAN)) {
        try {
            mergeDirs(OLD_GLOBAL_AI_MAN, NEW_GLOBAL_DIR);
            safeRename(OLD_GLOBAL_AI_MAN, OLD_GLOBAL_AI_MAN + '.migrated');
            console.log(`[migrate] Moved global config ${OLD_GLOBAL_AI_MAN} → ${NEW_GLOBAL_DIR}`);
            migrated = true;
        } catch (err) {
            console.warn(`[migrate] Failed to migrate ${OLD_GLOBAL_AI_MAN}: ${err.message}`);
        }
    }

    // 2. ~/.oboto-service → ~/.oboto (tray-app preferences)
    if (fs.existsSync(OLD_GLOBAL_DIR)) {
        try {
            mergeDirs(OLD_GLOBAL_DIR, NEW_GLOBAL_DIR);
            safeRename(OLD_GLOBAL_DIR, OLD_GLOBAL_DIR + '.migrated');
            console.log(`[migrate] Moved global config ${OLD_GLOBAL_DIR} → ${NEW_GLOBAL_DIR}`);
            migrated = true;
        } catch (err) {
            console.warn(`[migrate] Failed to migrate ${OLD_GLOBAL_DIR}: ${err.message}`);
        }
    }

    return migrated;
}

/**
 * Migrate legacy .secrets.enc from project root to ~/.oboto/.secrets.enc.
 * The old SecretsManager stored the vault at the Oboto project root;
 * the new one stores it in ~/.oboto/.
 * @param {string} [projectRoot] — Oboto project root (defaults to cwd)
 * @returns {boolean} true if migration was performed
 */
export function migrateSecretsFile(projectRoot) {
    const root = projectRoot || process.cwd();
    const legacyPath = path.join(root, '.secrets.enc');
    const newPath = path.join(NEW_GLOBAL_DIR, '.secrets.enc');

    if (!fs.existsSync(legacyPath)) return false;
    if (fs.existsSync(newPath)) return false; // new location already exists, don't overwrite

    try {
        if (!fs.existsSync(NEW_GLOBAL_DIR)) {
            fs.mkdirSync(NEW_GLOBAL_DIR, { recursive: true });
        }
        fs.copyFileSync(legacyPath, newPath);
        safeRename(legacyPath, legacyPath + '.migrated');
        console.log(`[migrate] Moved secrets vault ${legacyPath} → ${newPath}`);
        return true;
    } catch (err) {
        console.warn(`[migrate] Failed to migrate secrets file: ${err.message}`);
        return false;
    }
}

/**
 * Run all migrations. Safe to call on every startup.
 *
 * NOTE: `migrateSecretsFile()` defaults to `process.cwd()` which, in normal
 * startup, is the Oboto project root — the location where the old
 * SecretsManager used to store `.secrets.enc`.
 *
 * @param {string} [workspaceDir] — optional workspace directory to migrate
 */
export function runMigrations(workspaceDir) {
    migrateGlobalConfig();
    migrateSecretsFile(); // project root (.secrets.enc → ~/.oboto/.secrets.enc)
    if (workspaceDir) {
        migrateWorkspaceConfig(workspaceDir);
    }
}
