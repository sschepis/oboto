/**
 * CheckpointStore — File-based persistence layer for task checkpoints.
 * 
 * Storage layout:
 *   .ai-man/checkpoints/
 *     task-{id}.checkpoint.json   - Individual task checkpoints
 *     wal.json                     - Write-ahead log for atomicity
 *     recovery-manifest.json       - Index of active checkpoints
 */

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';

const CHECKPOINTS_DIR = '.ai-man/checkpoints';
const WAL_FILE = 'wal.json';
const MANIFEST_FILE = 'recovery-manifest.json';

export class CheckpointStore {
    /**
     * @param {string} workingDir - Workspace root directory
     * @param {Object} [options]
     * @param {number} [options.maxCheckpointAge] - Max age in ms before cleanup (default: 24h)
     */
    constructor(workingDir, options = {}) {
        this.workingDir = workingDir;
        this.checkpointsDir = path.join(workingDir, CHECKPOINTS_DIR);
        this.walPath = path.join(this.checkpointsDir, WAL_FILE);
        this.manifestPath = path.join(this.checkpointsDir, MANIFEST_FILE);
        this.maxCheckpointAge = options.maxCheckpointAge || 24 * 60 * 60 * 1000; // 24 hours
        
        this._ensureDirectory();
    }

    /**
     * Ensure the checkpoints directory exists.
     * Can be called synchronously or via the async wrapper.
     */
    _ensureDirectory() {
        try {
            if (!fs.existsSync(this.checkpointsDir)) {
                fs.mkdirSync(this.checkpointsDir, { recursive: true });
            }
        } catch (error) {
            consoleStyler.log('error', `Failed to create checkpoints directory: ${error.message}`);
        }
    }

    /**
     * Async version of _ensureDirectory for use in async methods.
     */
    async _ensureDirectoryAsync() {
        try {
            await fs.promises.mkdir(this.checkpointsDir, { recursive: true });
        } catch (error) {
            // Ignore EEXIST errors (directory already exists)
            if (error.code !== 'EEXIST') {
                consoleStyler.log('error', `Failed to create checkpoints directory: ${error.message}`);
            }
        }
    }

    /**
     * Get the checkpoint file path for a task ID.
     * @param {string} taskId 
     * @returns {string}
     */
    _getCheckpointPath(taskId) {
        // Sanitize taskId for filesystem safety
        const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.checkpointsDir, `task-${safeId}.checkpoint.json`);
    }

    // ─── Write-Ahead Log (WAL) ─────────────────────────────────────────

    /**
     * Append an operation to the write-ahead log.
     * For simplicity and robustness, we now write a single-entry WAL per operation.
     * This prevents corruption from accumulated entries.
     * @param {string} operation - 'write' | 'delete'
     * @param {string} taskId 
     * @param {Object} [data] - Checkpoint data (for write operations)
     */
    async _appendToWAL(operation, taskId, data = null) {
        const entry = {
            operation,
            taskId,
            timestamp: Date.now(),
            data
        };

        try {
            // Ensure directory exists before writing
            await this._ensureDirectoryAsync();
            
            // Write a single-entry WAL (simpler and more robust than accumulating)
            // This acts as a "current operation" marker that we clear on success
            const wal = [entry];
            
            // Write WAL atomically using temp file
            const tempPath = `${this.walPath}.${Date.now()}-${Math.random().toString(36).substr(2, 5)}.tmp`;
            await fs.promises.writeFile(tempPath, JSON.stringify(wal), 'utf8');
            await fs.promises.rename(tempPath, this.walPath);
        } catch (error) {
            consoleStyler.log('error', `WAL append failed: ${error.message}`);
            // Don't throw - allow the operation to continue without WAL protection
            // Better to potentially lose a checkpoint than to fail every operation
        }
    }

    /**
     * Clear the WAL after successful operations.
     */
    async _clearWAL() {
        try {
            if (fs.existsSync(this.walPath)) {
                await fs.promises.unlink(this.walPath);
            }
        } catch (error) {
            consoleStyler.log('warning', `Failed to clear WAL: ${error.message}`);
        }
    }

    /**
     * Replay the WAL to recover from partial writes.
     * Called on startup.
     */
    async replayWAL() {
        if (!fs.existsSync(this.walPath)) {
            return { replayed: 0, errors: [] };
        }

        try {
            const content = await fs.promises.readFile(this.walPath, 'utf8');
            
            let wal;
            try {
                wal = JSON.parse(content);
            } catch (parseError) {
                // WAL is corrupted - clear it and continue
                consoleStyler.log('warning', `Corrupted WAL detected, clearing it`);
                await this._clearWAL();
                return { replayed: 0, errors: [{ taskId: 'WAL', error: 'Corrupted, cleared' }] };
            }
            
            // Ensure wal is an array
            if (!Array.isArray(wal)) {
                await this._clearWAL();
                return { replayed: 0, errors: [] };
            }
            
            const errors = [];
            let replayed = 0;

            for (const entry of wal) {
                try {
                    if (entry.operation === 'write' && entry.data) {
                        const checkpointPath = this._getCheckpointPath(entry.taskId);
                        await fs.promises.writeFile(
                            checkpointPath, 
                            JSON.stringify(entry.data, null, 2), 
                            'utf8'
                        );
                        replayed++;
                    } else if (entry.operation === 'delete') {
                        const checkpointPath = this._getCheckpointPath(entry.taskId);
                        if (fs.existsSync(checkpointPath)) {
                            await fs.promises.unlink(checkpointPath);
                        }
                        replayed++;
                    }
                } catch (err) {
                    errors.push({ taskId: entry.taskId, error: err.message });
                }
            }

            await this._clearWAL();
            return { replayed, errors };
        } catch (error) {
            consoleStyler.log('error', `WAL replay failed: ${error.message}`);
            // Try to clear corrupted WAL
            await this._clearWAL();
            return { replayed: 0, errors: [{ taskId: 'WAL', error: error.message }] };
        }
    }

    // ─── Checkpoint Operations ─────────────────────────────────────────

    /**
     * Save a checkpoint for a task.
     * @param {string} taskId 
     * @param {Object} checkpoint - The checkpoint data
     * @returns {Promise<boolean>}
     */
    async saveCheckpoint(taskId, checkpoint) {
        const checkpointPath = this._getCheckpointPath(taskId);
        
        const envelope = {
            ...checkpoint,
            _meta: {
                taskId,
                savedAt: new Date().toISOString(),
                version: 1
            }
        };

        try {
            // Write to WAL first
            await this._appendToWAL('write', taskId, envelope);
            
            // Then write the actual checkpoint file atomically
            const tempPath = `${checkpointPath}.${Date.now()}-${Math.random().toString(36).substr(2, 5)}.tmp`;
            await fs.promises.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
            await fs.promises.rename(tempPath, checkpointPath);
            
            // Update manifest
            await this._updateManifest(taskId, 'active', checkpoint.status);
            
            // Clear WAL after successful write
            await this._clearWAL();
            
            return true;
        } catch (error) {
            consoleStyler.log('error', `Failed to save checkpoint for ${taskId}: ${error.message}`);
            return false;
        }
    }

    /**
     * Load a checkpoint for a task.
     * @param {string} taskId 
     * @returns {Promise<Object|null>}
     */
    async loadCheckpoint(taskId) {
        const checkpointPath = this._getCheckpointPath(taskId);
        
        try {
            if (!fs.existsSync(checkpointPath)) {
                return null;
            }
            
            const content = await fs.promises.readFile(checkpointPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            consoleStyler.log('error', `Failed to load checkpoint for ${taskId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Delete a checkpoint for a task.
     * @param {string} taskId 
     * @returns {Promise<boolean>}
     */
    async deleteCheckpoint(taskId) {
        const checkpointPath = this._getCheckpointPath(taskId);
        
        try {
            await this._appendToWAL('delete', taskId);
            
            if (fs.existsSync(checkpointPath)) {
                await fs.promises.unlink(checkpointPath);
            }
            
            await this._removeFromManifest(taskId);
            
            return true;
        } catch (error) {
            consoleStyler.log('error', `Failed to delete checkpoint for ${taskId}: ${error.message}`);
            return false;
        }
    }

    // ─── Manifest Operations ───────────────────────────────────────────

    /**
     * Load the recovery manifest.
     * @returns {Promise<Object>}
     */
    async _loadManifest() {
        try {
            if (!fs.existsSync(this.manifestPath)) {
                return { tasks: {}, lastUpdated: null };
            }
            const content = await fs.promises.readFile(this.manifestPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return { tasks: {}, lastUpdated: null };
        }
    }

    /**
     * Save the recovery manifest.
     * @param {Object} manifest 
     */
    async _saveManifest(manifest) {
        manifest.lastUpdated = new Date().toISOString();
        
        try {
            // Ensure directory exists before writing
            await this._ensureDirectoryAsync();
            
            const tempPath = `${this.manifestPath}.${Date.now()}-${Math.random().toString(36).substr(2, 5)}.tmp`;
            await fs.promises.writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
            await fs.promises.rename(tempPath, this.manifestPath);
        } catch (error) {
            consoleStyler.log('error', `Failed to save manifest: ${error.message}`);
        }
    }

    /**
     * Update a task entry in the manifest.
     * @param {string} taskId 
     * @param {string} state - 'active' | 'recovered' | 'completed'
     * @param {string} status - Task status
     */
    async _updateManifest(taskId, state, status) {
        const manifest = await this._loadManifest();
        
        manifest.tasks[taskId] = {
            state,
            status,
            lastCheckpoint: new Date().toISOString()
        };
        
        await this._saveManifest(manifest);
    }

    /**
     * Remove a task from the manifest.
     * @param {string} taskId 
     */
    async _removeFromManifest(taskId) {
        const manifest = await this._loadManifest();
        delete manifest.tasks[taskId];
        await this._saveManifest(manifest);
    }

    // ─── Batch Operations ──────────────────────────────────────────────

    /**
     * List all checkpoints that need recovery.
     * @returns {Promise<Array<{taskId: string, checkpoint: Object}>>}
     */
    async listRecoverableCheckpoints() {
        const recoverable = [];
        
        try {
            const manifest = await this._loadManifest();
            
            for (const [taskId, entry] of Object.entries(manifest.tasks)) {
                // Only recover tasks that were active (not already completed)
                if (entry.state === 'active' && 
                    (entry.status === 'running' || entry.status === 'queued')) {
                    
                    const checkpoint = await this.loadCheckpoint(taskId);
                    if (checkpoint) {
                        recoverable.push({ taskId, checkpoint, manifestEntry: entry });
                    }
                }
            }
            
            return recoverable;
        } catch (error) {
            consoleStyler.log('error', `Failed to list recoverable checkpoints: ${error.message}`);
            return [];
        }
    }

    /**
     * List all checkpoint files (for debugging/admin).
     * @returns {Promise<Array<string>>}
     */
    async listAllCheckpoints() {
        try {
            if (!fs.existsSync(this.checkpointsDir)) {
                return [];
            }
            
            const files = await fs.promises.readdir(this.checkpointsDir);
            return files
                .filter(f => f.endsWith('.checkpoint.json'))
                .map(f => f.replace('task-', '').replace('.checkpoint.json', ''));
        } catch (error) {
            consoleStyler.log('error', `Failed to list checkpoints: ${error.message}`);
            return [];
        }
    }

    /**
     * Clean up old checkpoints beyond max age.
     * @returns {Promise<number>} Number of checkpoints cleaned
     */
    async cleanupOldCheckpoints() {
        const now = Date.now();
        let cleaned = 0;
        
        try {
            if (!fs.existsSync(this.checkpointsDir)) {
                return 0;
            }
            
            const files = await fs.promises.readdir(this.checkpointsDir);
            
            for (const file of files) {
                if (!file.endsWith('.checkpoint.json')) continue;
                
                const filePath = path.join(this.checkpointsDir, file);
                const stat = await fs.promises.stat(filePath);
                
                if (now - stat.mtimeMs > this.maxCheckpointAge) {
                    await fs.promises.unlink(filePath);
                    cleaned++;
                    
                    // Also remove from manifest
                    const taskId = file.replace('task-', '').replace('.checkpoint.json', '');
                    await this._removeFromManifest(taskId);
                }
            }
            
            if (cleaned > 0) {
                consoleStyler.log('system', `🧹 Cleaned up ${cleaned} old checkpoint(s)`);
            }
            
            return cleaned;
        } catch (error) {
            consoleStyler.log('error', `Checkpoint cleanup failed: ${error.message}`);
            return 0;
        }
    }

    /**
     * Mark a checkpoint as recovered (so it won't be recovered again).
     * @param {string} taskId 
     */
    async markRecovered(taskId) {
        await this._updateManifest(taskId, 'recovered', 'recovered');
    }

    /**
     * Mark a task as completed (clears its checkpoint).
     * @param {string} taskId 
     * @param {boolean} [keepCheckpoint=false] - If true, keep the file but mark completed
     */
    async markCompleted(taskId, keepCheckpoint = false) {
        if (keepCheckpoint) {
            await this._updateManifest(taskId, 'completed', 'completed');
        } else {
            await this.deleteCheckpoint(taskId);
        }
    }

    /**
     * Switch to a new workspace directory.
     * @param {string} newWorkingDir 
     */
    switchWorkspace(newWorkingDir) {
        this.workingDir = newWorkingDir;
        this.checkpointsDir = path.join(newWorkingDir, CHECKPOINTS_DIR);
        this.walPath = path.join(this.checkpointsDir, WAL_FILE);
        this.manifestPath = path.join(this.checkpointsDir, MANIFEST_FILE);
        this._ensureDirectory();
    }
}
