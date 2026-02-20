// CloudFileSync — Cloud storage integration for workspace files
// Provides upload, download, and listing of files in Supabase Storage.
// Uses the workspace_files table for metadata tracking and checksum-based delta sync.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Manages file synchronization between local workspace and cloud storage.
 * Files are stored in the Supabase Storage 'workspace-files' bucket.
 * Metadata (checksums, versions, paths) is tracked in the workspace_files table.
 *
 * Emits events:
 *   cloud:file:uploaded    { filePath, cloudPath, size }
 *   cloud:file:downloaded  { filePath, cloudPath, size }
 *   cloud:file:deleted     { filePath, cloudPath }
 */
export class CloudFileSync {
    /**
     * @param {import('./cloud-client.mjs').CloudClient} client
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     */
    constructor(client, eventBus) {
        this.client = client;
        this.eventBus = eventBus;
    }

    /**
     * Upload a file to cloud storage.
     * @param {string} workspaceId — Cloud workspace UUID
     * @param {string} localDir — Local workspace root directory
     * @param {string} relativePath — File path relative to workspace root
     * @returns {Promise<object>} Upload result with storage path
     */
    async uploadFile(workspaceId, localDir, relativePath) {
        const fullPath = path.join(localDir, relativePath);
        const content = await fs.promises.readFile(fullPath);
        const checksum = crypto.createHash('sha256').update(content).digest('hex');
        const storagePath = `${workspaceId}/${relativePath}`;

        // Upload to Supabase Storage
        const uploadRes = await this.client.request(
            `/storage/v1/object/workspace-files/${storagePath}`,
            {
                method: 'POST',
                body: content,
                headers: {
                    'Content-Type': 'application/octet-stream',
                },
            }
        );

        // Upsert metadata in workspace_files table
        await this.client.post('/rest/v1/workspace_files', {
            workspace_id: workspaceId,
            file_path: relativePath,
            storage_path: storagePath,
            file_size: content.length,
            checksum,
            mime_type: this._getMimeType(relativePath),
            file_type: path.extname(relativePath).slice(1) || 'unknown',
            version: 1,
            is_deleted: false,
        }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:file:uploaded', {
                filePath: relativePath,
                cloudPath: storagePath,
                size: content.length,
            });
        }

        return { storagePath, size: content.length, checksum };
    }

    /**
     * Download a file from cloud storage.
     * @param {string} workspaceId — Cloud workspace UUID
     * @param {string} localDir — Local workspace root directory
     * @param {string} relativePath — File path relative to workspace root
     * @returns {Promise<object>} Download result
     */
    async downloadFile(workspaceId, localDir, relativePath) {
        const storagePath = `${workspaceId}/${relativePath}`;

        const content = await this.client.request(
            `/storage/v1/object/workspace-files/${storagePath}`,
            { method: 'GET', headers: { 'Accept': '*/*' } }
        );

        const fullPath = path.join(localDir, relativePath);
        const dir = path.dirname(fullPath);
        await fs.promises.mkdir(dir, { recursive: true });

        // Content may be text or binary
        if (typeof content === 'string') {
            await fs.promises.writeFile(fullPath, content, 'utf8');
        } else if (Buffer.isBuffer(content)) {
            await fs.promises.writeFile(fullPath, content);
        } else {
            await fs.promises.writeFile(fullPath, JSON.stringify(content), 'utf8');
        }

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:file:downloaded', {
                filePath: relativePath,
                cloudPath: storagePath,
                size: typeof content === 'string' ? content.length : 0,
            });
        }

        return { filePath: fullPath, storagePath };
    }

    /**
     * List files tracked in cloud storage for a workspace.
     * @param {string} workspaceId
     * @returns {Promise<Array>} List of file metadata objects
     */
    async listFiles(workspaceId) {
        const rows = await this.client.get(
            `/rest/v1/workspace_files?workspace_id=eq.${workspaceId}&is_deleted=eq.false&select=id,file_path,file_size,checksum,mime_type,file_type,version,updated_at&order=file_path.asc`
        );
        return rows || [];
    }

    /**
     * Delete a file from cloud storage (soft delete — marks as deleted).
     * @param {string} workspaceId
     * @param {string} relativePath
     * @returns {Promise<void>}
     */
    async deleteFile(workspaceId, relativePath) {
        const storagePath = `${workspaceId}/${relativePath}`;

        // Try to delete from storage
        try {
            await this.client.delete(`/storage/v1/object/workspace-files/${storagePath}`);
        } catch {
            // File might not exist in storage
        }

        // Mark as deleted in metadata
        await this.client.patch(
            `/rest/v1/workspace_files?workspace_id=eq.${workspaceId}&file_path=eq.${relativePath}`,
            { is_deleted: true }
        );

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:file:deleted', {
                filePath: relativePath,
                cloudPath: storagePath,
            });
        }
    }

    /**
     * Get checksums of local files for delta comparison.
     * @param {string} localDir
     * @param {string[]} filePaths — Relative paths to check
     * @returns {Promise<Map<string, string>>} Map of relativePath → SHA-256 checksum
     */
    async getLocalChecksums(localDir, filePaths) {
        const checksums = new Map();
        for (const fp of filePaths) {
            try {
                const content = await fs.promises.readFile(path.join(localDir, fp));
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                checksums.set(fp, hash);
            } catch {
                // File doesn't exist locally
            }
        }
        return checksums;
    }

    /**
     * Compute files that need syncing by comparing local and cloud checksums.
     * @param {string} workspaceId
     * @param {string} localDir
     * @returns {Promise<{ toUpload: string[], toDownload: string[], synced: string[] }>}
     */
    async computeDelta(workspaceId, localDir) {
        const cloudFiles = await this.listFiles(workspaceId);
        const cloudPaths = cloudFiles.map(f => f.file_path);
        const localChecksums = await this.getLocalChecksums(localDir, cloudPaths);

        const toUpload = [];
        const toDownload = [];
        const synced = [];

        for (const cf of cloudFiles) {
            const localChecksum = localChecksums.get(cf.file_path);
            if (!localChecksum) {
                // File exists in cloud but not locally — download
                toDownload.push(cf.file_path);
            } else if (localChecksum !== cf.checksum) {
                // Checksums differ — for now, local wins (push)
                toUpload.push(cf.file_path);
            } else {
                synced.push(cf.file_path);
            }
        }

        return { toUpload, toDownload, synced };
    }

    /**
     * Basic MIME type detection from file extension.
     * @param {string} filePath
     * @returns {string}
     */
    _getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
            '.js': 'application/javascript',
            '.mjs': 'application/javascript',
            '.ts': 'application/typescript',
            '.tsx': 'application/typescript',
            '.json': 'application/json',
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.css': 'text/css',
            '.py': 'text/x-python',
            '.rs': 'text/x-rust',
            '.go': 'text/x-go',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
            '.toml': 'text/toml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.gif': 'image/gif',
            '.pdf': 'application/pdf',
        };
        return mimeMap[ext] || 'application/octet-stream';
    }
}
