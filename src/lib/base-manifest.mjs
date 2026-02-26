// BaseManifest — Shared base class for manifest management
// Consolidated from ProjectManifest and ManifestManager
// See docs/DUPLICATE_CODE_ANALYSIS.md — DUP-2

import fs from 'fs';
import path from 'path';
import { buildMarkdownTable, parseMarkdownTable } from './markdown-utils.mjs';
import { generateId } from './id-utils.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Base class providing common manifest file operations.
 * Subclasses provide domain-specific section definitions and creation logic.
 *
 * Shared operations:
 * - hasManifest() / readManifest() / writeManifest()
 * - updateSection() — regex-based section replacement with automatic snapshot
 * - createSnapshot() / listSnapshots() / restoreSnapshot()
 * - buildTable() / parseTableSection()
 * - generateId()
 */
export class BaseManifest {
    /**
     * @param {string} workingDir - Workspace directory
     * @param {string} manifestFilename - Name of the manifest file (e.g., 'PROJECT_MAP.md', 'SYSTEM_MAP.md')
     * @param {string} snapshotsDirName - Name of the snapshots directory (e.g., '.project-snapshots', '.snapshots')
     */
    constructor(workingDir, manifestFilename, snapshotsDirName) {
        this.workingDir = workingDir;
        this.manifestFilename = manifestFilename;
        this.manifestPath = path.join(workingDir, manifestFilename);
        this.snapshotsDirName = snapshotsDirName;
        this.snapshotsDir = path.join(workingDir, snapshotsDirName);
    }

    // ── Core file operations ────────────────────────────────────────────

    /**
     * Check if the manifest file exists.
     * @returns {boolean}
     */
    hasManifest() {
        return fs.existsSync(this.manifestPath);
    }

    /**
     * Read the manifest content as a string.
     * @returns {Promise<string|null>}
     */
    async readManifest() {
        if (!this.hasManifest()) return null;
        return await fs.promises.readFile(this.manifestPath, 'utf8');
    }

    /**
     * Write content to the manifest file.
     * @param {string} content
     */
    async writeManifest(content) {
        await fs.promises.writeFile(this.manifestPath, content, 'utf8');
    }

    // ── Section operations ──────────────────────────────────────────────

    /**
     * Update a specific section of the manifest by name.
     * Creates a snapshot before updating.
     *
     * @param {string} sectionName - Section heading (e.g., '2. Goals & Success Criteria')
     * @param {string} newContent - New content for the section body
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async updateSection(sectionName, newContent) {
        if (!this.hasManifest()) {
            throw new Error(`Manifest not found. Initialize ${this.manifestFilename} first.`);
        }

        await this.createSnapshot(`Pre-update: ${sectionName}`);

        let content = await this.readManifest();
        const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sectionRegex = new RegExp(`(## ${escapedName})[\\s\\S]*?(?=## |$)`, 'g');

        if (!sectionRegex.test(content)) {
            content += `\n\n## ${sectionName}\n${newContent}`;
        } else {
            content = content.replace(sectionRegex, `$1\n${newContent}\n`);
        }

        // Update timestamp
        content = content.replace(/Last Updated: .*/, `Last Updated: ${new Date().toISOString()}`);

        await this.writeManifest(content);
        return { success: true, message: `Section '${sectionName}' updated.` };
    }

    /**
     * Parse a table from a named section of the manifest.
     *
     * @param {string} content - Full manifest content
     * @param {string} sectionHeader - Full section header (e.g., '## 2. Goals & Success Criteria')
     * @returns {Record<string, string>[]} Parsed rows
     */
    parseTableSection(content, sectionHeader) {
        const escapedHeader = sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sectionRegex = new RegExp(`${escapedHeader}([\\s\\S]*?)(?=## \\d|$)`);
        const match = content.match(sectionRegex);
        if (!match) return [];

        const { rows } = parseMarkdownTable(match[1]);
        return rows;
    }

    // ── Table building ──────────────────────────────────────────────────

    /**
     * Build a markdown table from headers and row arrays.
     * Delegates to the shared utility.
     */
    buildTable(headers, rows) {
        return buildMarkdownTable(headers, rows);
    }

    // ── ID generation ───────────────────────────────────────────────────

    /**
     * Generate a unique ID with the given prefix.
     * Delegates to the shared utility.
     */
    generateId(prefix = 'ITEM') {
        return generateId(prefix);
    }

    // ── Snapshot operations ─────────────────────────────────────────────

    /**
     * Create a backup snapshot of the current manifest.
     * @param {string} description - Description of the snapshot reason
     */
    async createSnapshot(description) {
        if (!this.hasManifest()) return;

        try {
            await fs.promises.mkdir(this.snapshotsDir, { recursive: true });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const snapshotFilename = `${this.manifestFilename.replace('.md', '')}.${timestamp}.md`;
            const snapshotPath = path.join(this.snapshotsDir, snapshotFilename);

            await fs.promises.copyFile(this.manifestPath, snapshotPath);

            // Append to snapshots section in the manifest
            await this._appendSnapshotLog(description, snapshotFilename);
        } catch (error) {
            consoleStyler.log('error', `Failed to create snapshot: ${error.message}`);
        }
    }

    /**
     * Append a snapshot log entry to the manifest's snapshots section.
     * Subclasses can override to customize the section header pattern.
     * @param {string} description
     * @param {string} snapshotFilename
     * @protected
     */
    async _appendSnapshotLog(description, snapshotFilename) {
        let content = await fs.promises.readFile(this.manifestPath, 'utf8');
        const now = new Date().toISOString();
        const logLine = `- [${now}] Snapshot: ${description} (${snapshotFilename})`;

        // Try common snapshot section patterns
        const patterns = [
            /## \d+\. State Snapshots([\s\S]*?)$/,
            /## State Snapshots([\s\S]*?)$/
        ];

        let matched = false;
        for (const pattern of patterns) {
            if (pattern.test(content)) {
                content = content.replace(pattern, (match, p1) => {
                    return match.replace(p1, p1.trimEnd() + '\n' + logLine + '\n');
                });
                matched = true;
                break;
            }
        }

        if (matched) {
            await fs.promises.writeFile(this.manifestPath, content, 'utf8');
        }
    }

    /**
     * List available snapshots, most recent first.
     * @returns {Promise<string[]>} Snapshot filenames
     */
    async listSnapshots() {
        try {
            if (!fs.existsSync(this.snapshotsDir)) return [];
            const files = await fs.promises.readdir(this.snapshotsDir);
            return files.filter(f => f.endsWith('.md')).sort().reverse();
        } catch (e) {
            return [];
        }
    }

    /**
     * Restore the manifest from a snapshot file.
     * @param {string} snapshotFilename - Snapshot filename (or partial name for search)
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async restoreSnapshot(snapshotFilename) {
        let targetPath = snapshotFilename;

        // Resolve path
        if (!path.isAbsolute(snapshotFilename) && !snapshotFilename.includes('/')) {
            targetPath = path.join(this.snapshotsDir, snapshotFilename);
        }

        // Try direct match first
        if (!fs.existsSync(targetPath)) {
            // Search for partial match
            try {
                const files = await fs.promises.readdir(this.snapshotsDir);
                const match = files.find(f => f.includes(snapshotFilename));
                if (match) {
                    targetPath = path.join(this.snapshotsDir, match);
                } else {
                    return { success: false, message: `Snapshot ${snapshotFilename} not found.` };
                }
            } catch (e) {
                return { success: false, message: `Snapshot ${snapshotFilename} not found.` };
            }
        }

        try {
            await fs.promises.copyFile(targetPath, this.manifestPath);
            return { success: true, message: `Restored from ${path.basename(targetPath)}` };
        } catch (error) {
            return { success: false, message: `Failed to restore: ${error.message}` };
        }
    }
}
