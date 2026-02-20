// CloudWorkspaceSync — Bidirectional workspace state sync
// Handles linking local workspace to cloud, pushing/pulling state.
// Uses .cloud-link.json in the workspace root for persistent link info.

import fs from 'fs';
import path from 'path';

const LINK_FILE = '.cloud-link.json';

/**
 * Manages bidirectional sync of workspace state between the local
 * WorkspaceManager and the cloud workspaces table.
 *
 * Sync model: last-write-wins with timestamps.
 *
 * Emits events:
 *   cloud:workspace:linked    { localDir, cloudWorkspaceId }
 *   cloud:workspace:unlinked  {}
 *   cloud:workspace:pushed    { workspaceId }
 *   cloud:workspace:pulled    { workspaceId, state }
 */
export class CloudWorkspaceSync {
    /**
     * @param {import('./cloud-client.mjs').CloudClient} client
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     */
    constructor(client, eventBus) {
        this.client = client;
        this.eventBus = eventBus;

        /** @type {object|null} Parsed .cloud-link.json content */
        this._linkData = null;
    }

    /**
     * Link the current local workspace to a cloud workspace.
     * Creates/updates .cloud-link.json in the workspace root.
     * @param {string} localDir — Local workspace directory path
     * @param {string} cloudWorkspaceId — Cloud workspace UUID
     * @param {string} [cloudWorkspaceName] — Human-readable name
     * @returns {Promise<void>}
     */
    async link(localDir, cloudWorkspaceId, cloudWorkspaceName = '') {
        this._linkData = {
            version: 1,
            cloudWorkspaceId,
            cloudWorkspaceName,
            linkedAt: new Date().toISOString(),
            lastSyncAt: null,
            conversations: {},
            syncConfig: {
                autoSync: true,
                syncIntervalMs: 30000,
                syncConversations: true,
                syncWorkspaceState: true,
                syncFiles: false,
            },
        };

        await this._saveLinkFile(localDir);

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:workspace:linked', {
                localDir,
                cloudWorkspaceId,
                cloudWorkspaceName,
            });
        }
    }

    /**
     * Unlink — remove the cloud association.
     * @param {string} localDir
     * @returns {Promise<void>}
     */
    async unlink(localDir) {
        this._linkData = null;
        const filePath = path.join(localDir, LINK_FILE);
        try {
            await fs.promises.unlink(filePath);
        } catch {
            // File might not exist
        }

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:workspace:unlinked', {});
        }
    }

    /**
     * Load link info from .cloud-link.json if it exists.
     * @param {string} localDir
     * @returns {Promise<object|null>} The link data, or null
     */
    async loadLink(localDir) {
        const filePath = path.join(localDir, LINK_FILE);
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            this._linkData = JSON.parse(content);
            return this._linkData;
        } catch {
            this._linkData = null;
            return null;
        }
    }

    /**
     * Get the current link data (in-memory).
     * @returns {object|null}
     */
    getLinkData() {
        return this._linkData;
    }

    /**
     * Get the linked cloud workspace ID.
     * @returns {string|null}
     */
    getLinkedWorkspaceId() {
        return this._linkData?.cloudWorkspaceId || null;
    }

    /**
     * Push local workspace state to cloud.
     * @param {string} cloudWorkspaceId
     * @param {object} localState — from WorkspaceManager.getWorkspaceContext()
     * @returns {Promise<object>} Updated cloud workspace row
     */
    async push(cloudWorkspaceId, localState) {
        if (!localState) return null;

        const body = {
            task_goal: localState.task_goal || null,
            current_step: localState.current_step || null,
            status: localState.status || 'idle',
            progress_data: localState.progress_data || {},
            next_steps: localState.next_steps || [],
            shared_memory: localState.shared_memory || {},
            last_active_at: new Date().toISOString(),
        };

        const result = await this.client.patch(
            `/rest/v1/workspaces?id=eq.${cloudWorkspaceId}`,
            body
        );

        // Update sync timestamp
        if (this._linkData) {
            this._linkData.lastSyncAt = new Date().toISOString();
        }

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:workspace:pushed', { workspaceId: cloudWorkspaceId });
        }

        return result;
    }

    /**
     * Pull cloud workspace state.
     * @param {string} cloudWorkspaceId
     * @returns {Promise<object|null>} Cloud workspace state
     */
    async pull(cloudWorkspaceId) {
        const rows = await this.client.get(
            `/rest/v1/workspaces?id=eq.${cloudWorkspaceId}&select=task_goal,current_step,status,progress_data,next_steps,shared_memory,updated_at,name,slug`
        );

        if (!rows || rows.length === 0) return null;

        const state = rows[0];

        // Update sync timestamp
        if (this._linkData) {
            this._linkData.lastSyncAt = new Date().toISOString();
        }

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:workspace:pulled', {
                workspaceId: cloudWorkspaceId,
                state,
            });
        }

        return state;
    }

    /**
     * List available cloud workspaces for an organization.
     * @param {string} orgId
     * @returns {Promise<Array>}
     */
    async listCloudWorkspaces(orgId) {
        const rows = await this.client.get(
            `/rest/v1/workspaces?org_id=eq.${orgId}&select=id,name,slug,description,status,task_goal,current_step,last_active_at&order=last_active_at.desc.nullslast`
        );
        return rows || [];
    }

    /**
     * Save .cloud-link.json to disk.
     * @param {string} localDir
     * @returns {Promise<void>}
     */
    async _saveLinkFile(localDir) {
        if (!this._linkData) return;
        const filePath = path.join(localDir, LINK_FILE);
        await fs.promises.writeFile(filePath, JSON.stringify(this._linkData, null, 2), 'utf8');
    }

    /**
     * Update and persist the link data.
     * @param {string} localDir
     * @returns {Promise<void>}
     */
    async saveLinkData(localDir) {
        await this._saveLinkFile(localDir);
    }
}
