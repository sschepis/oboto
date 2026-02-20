// CloudConversationSync — Conversation and message sync with cloud
// Append-only message sync with high-water mark tracking.
// Maps local conversation names to cloud conversation UUIDs.

import crypto from 'crypto';

/**
 * Syncs conversations and messages between local ConversationManager
 * and cloud conversations/messages tables.
 *
 * Local conversations: JSON files keyed by name (e.g., "chat", "research")
 * Cloud conversations: keyed by UUID
 * Mapping: stored in .cloud-link.json's conversations field
 *
 * Sync model: append-only. System messages are excluded from sync.
 */
export class CloudConversationSync {
    /**
     * @param {import('./cloud-client.mjs').CloudClient} client
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     */
    constructor(client, eventBus) {
        this.client = client;
        this.eventBus = eventBus;
    }

    /**
     * List conversations for a cloud workspace.
     * @param {string} cloudWorkspaceId
     * @returns {Promise<Array>}
     */
    async listCloudConversations(cloudWorkspaceId) {
        const rows = await this.client.get(
            `/rest/v1/conversations?workspace_id=eq.${cloudWorkspaceId}&select=id,name,conversation_type,is_archived,created_at&order=created_at.asc`
        );
        return rows || [];
    }

    /**
     * Create a new conversation in the cloud workspace.
     * @param {string} cloudWorkspaceId
     * @param {string} name — e.g. "chat"
     * @param {string} [type='chat'] — conversation_type
     * @param {string} [userId] — started_by user ID
     * @returns {Promise<object>} Created conversation row
     */
    async createCloudConversation(cloudWorkspaceId, name, type = 'chat', userId = null) {
        const body = {
            workspace_id: cloudWorkspaceId,
            name,
            conversation_type: type,
        };
        if (userId) body.started_by = userId;

        const rows = await this.client.post(
            '/rest/v1/conversations',
            body,
            { 'Prefer': 'return=representation' }
        );
        return Array.isArray(rows) ? rows[0] : rows;
    }

    /**
     * Push new messages from a local conversation to cloud.
     * Only pushes messages not yet synced (after lastSyncAt).
     * Filters out system messages and tool messages.
     *
     * @param {string} cloudConvId — Cloud conversation UUID
     * @param {Array} messages — Full local message history
     * @param {string|null} lastSyncAt — ISO timestamp of last sync
     * @param {string|null} userId — Current user's cloud ID
     * @returns {Promise<{ pushed: number, lastSyncAt: string }>}
     */
    async pushMessages(cloudConvId, messages, lastSyncAt = null, userId = null) {
        // Filter to syncable messages (user + assistant only)
        const syncable = messages.filter(m =>
            m.role === 'user' || m.role === 'assistant'
        );

        // Filter to messages after lastSyncAt
        // Since local messages don't have timestamps, we use index-based tracking
        // The lastSyncAt acts as a count marker
        let newMessages = syncable;
        if (lastSyncAt) {
            // Use content hash deduplication instead of timestamp
            // Pull recent cloud messages and build a set of content hashes
            const recentCloud = await this._getRecentCloudHashes(cloudConvId, 50);
            newMessages = syncable.filter(m => {
                const hash = this._hashMessage(m);
                return !recentCloud.has(hash);
            });
        }

        if (newMessages.length === 0) {
            return { pushed: 0, lastSyncAt: new Date().toISOString() };
        }

        // Push each message
        let pushed = 0;
        for (const msg of newMessages) {
            try {
                const body = {
                    conversation_id: cloudConvId,
                    content: msg.content,
                    role: msg.role,
                };
                if (msg.role === 'user' && userId) {
                    body.sender_user_id = userId;
                }
                await this.client.post('/rest/v1/messages', body);
                pushed++;
            } catch (err) {
                console.warn(`[CloudConversationSync] Failed to push message: ${err.message}`);
                // Continue with remaining messages
            }
        }

        const newLastSyncAt = new Date().toISOString();
        return { pushed, lastSyncAt: newLastSyncAt };
    }

    /**
     * Pull new messages from a cloud conversation.
     * Returns messages created after the given timestamp,
     * excluding messages sent by the current user (to avoid echoes).
     *
     * @param {string} cloudConvId — Cloud conversation UUID
     * @param {string|null} since — ISO timestamp
     * @param {string|null} userId — Current user ID (to filter out own messages)
     * @returns {Promise<{ messages: Array, lastCloudMessageAt: string|null }>}
     */
    async pullMessages(cloudConvId, since = null, userId = null) {
        let query = `/rest/v1/messages?conversation_id=eq.${cloudConvId}&select=id,content,role,sender_user_id,sender_agent_id,model_used,created_at&order=created_at.asc`;

        if (since) {
            query += `&created_at=gt.${since}`;
        }

        query += '&limit=200';

        const rows = await this.client.get(query);
        if (!rows || rows.length === 0) {
            return { messages: [], lastCloudMessageAt: since };
        }

        // Filter out messages sent by ourselves
        const newMessages = userId
            ? rows.filter(m => m.sender_user_id !== userId)
            : rows;

        // Map to local message format
        const localMessages = newMessages.map(m => ({
            role: m.role,
            content: m.content,
            _cloudId: m.id,
            _cloudSenderAgent: m.sender_agent_id,
            _cloudCreatedAt: m.created_at,
        }));

        const lastCloudMessageAt = rows[rows.length - 1]?.created_at || since;

        return { messages: localMessages, lastCloudMessageAt };
    }

    /**
     * Get content hashes of recent cloud messages for deduplication.
     * @param {string} cloudConvId
     * @param {number} limit
     * @returns {Promise<Set<string>>}
     */
    async _getRecentCloudHashes(cloudConvId, limit = 50) {
        try {
            const rows = await this.client.get(
                `/rest/v1/messages?conversation_id=eq.${cloudConvId}&select=content,role&order=created_at.desc&limit=${limit}`
            );
            const hashes = new Set();
            for (const row of (rows || [])) {
                hashes.add(this._hashMessage(row));
            }
            return hashes;
        } catch {
            return new Set();
        }
    }

    /**
     * Create a deterministic hash for a message (for deduplication).
     * @param {{ role: string, content: string }} msg
     * @returns {string}
     */
    _hashMessage(msg) {
        const input = `${msg.role}:${(msg.content || '').slice(0, 500)}`;
        return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
    }
}
