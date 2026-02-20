// CloudRealtime — WebSocket realtime connection for live collaboration
// Implements the Phoenix Channel protocol over WebSocket for:
//   - Presence (who's online in a workspace)
//   - Postgres Changes (live messages, workspace updates)
//   - Broadcast (ephemeral events: typing, cursors)
// Uses the `ws` package already in ai-man's dependencies.

import WebSocket from 'ws';

const HEARTBEAT_INTERVAL = 30000; // 30s
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

/**
 * Phoenix Channel WebSocket client for Supabase Realtime.
 * Connects to the cloud backend's realtime endpoint and manages
 * channel subscriptions for live updates.
 */
export class CloudRealtime {
    /**
     * @param {string} cloudUrl — Cloud base URL (https://...)
     * @param {string} anonKey — Public anon API key
     * @param {string} accessToken — User's JWT access token
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     */
    constructor(cloudUrl, anonKey, accessToken, eventBus) {
        this.cloudUrl = cloudUrl;
        this.anonKey = anonKey;
        this.accessToken = accessToken;
        this.eventBus = eventBus;

        /** @type {WebSocket|null} */
        this.ws = null;

        /** @type {ReturnType<typeof setInterval>|null} */
        this._heartbeatTimer = null;

        /** @type {number} Auto-incrementing message ref */
        this._ref = 0;

        /** @type {Map<string, Function[]>} Channel topic → callback arrays */
        this._channelCallbacks = new Map();

        /** @type {Set<string>} Joined channel topics */
        this._joinedChannels = new Set();

        /** @type {boolean} */
        this._connected = false;

        /** @type {number} */
        this._reconnectAttempts = 0;

        /** @type {boolean} */
        this._intentionalClose = false;
    }

    /**
     * Connect to the Supabase Realtime WebSocket endpoint.
     * @returns {Promise<void>} Resolves when connected
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this._connected) { resolve(); return; }

            this._intentionalClose = false;
            const wsUrl = `${this.cloudUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/realtime/v1/websocket?apikey=${this.anonKey}&vsn=1.0.0`;

            try {
                this.ws = new WebSocket(wsUrl);
            } catch (err) {
                reject(err);
                return;
            }

            this.ws.on('open', () => {
                this._connected = true;
                this._reconnectAttempts = 0;
                this._startHeartbeat();
                this._authenticate();

                // Re-join any previously subscribed channels
                for (const topic of this._joinedChannels) {
                    this._sendJoin(topic);
                }

                if (this.eventBus) {
                    this.eventBus.emitTyped('cloud:realtime:connected', {});
                }
                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this._handleMessage(msg);
                } catch {
                    // Ignore unparseable messages
                }
            });

            this.ws.on('close', () => {
                this._connected = false;
                this._stopHeartbeat();

                if (this.eventBus) {
                    this.eventBus.emitTyped('cloud:realtime:disconnected', {});
                }

                // Auto-reconnect unless intentionally closed
                if (!this._intentionalClose) {
                    this._scheduleReconnect();
                }
            });

            this.ws.on('error', (err) => {
                console.warn(`[CloudRealtime] WebSocket error: ${err.message}`);
                if (!this._connected) {
                    reject(err);
                }
            });
        });
    }

    /**
     * Disconnect and clean up.
     */
    disconnect() {
        this._intentionalClose = true;
        this._stopHeartbeat();
        this._joinedChannels.clear();
        this._channelCallbacks.clear();

        if (this.ws) {
            try { this.ws.close(); } catch { /* ignore */ }
            this.ws = null;
        }
        this._connected = false;
    }

    /**
     * Whether the WebSocket is currently connected.
     * @returns {boolean}
     */
    isConnected() {
        return this._connected;
    }

    // ── Channel Subscriptions ─────────────────────────────────────────────

    /**
     * Subscribe to Postgres Changes on a table.
     * @param {string} table — Table name (e.g. "messages")
     * @param {string} filter — PostgREST filter (e.g. "conversation_id=eq.uuid")
     * @param {string} event — 'INSERT' | 'UPDATE' | 'DELETE' | '*'
     * @param {Function} callback — Called with { type, record, old_record }
     * @returns {string} Channel topic for unsubscribing
     */
    subscribeToChanges(table, filter, event = '*', callback) {
        const topic = `realtime:public:${table}:${filter}`;

        // Register callback
        if (!this._channelCallbacks.has(topic)) {
            this._channelCallbacks.set(topic, []);
        }
        this._channelCallbacks.get(topic).push(callback);

        // Join channel
        if (!this._joinedChannels.has(topic)) {
            this._joinedChannels.add(topic);
            if (this._connected) {
                this._sendJoin(topic, {
                    postgres_changes: [{
                        event,
                        schema: 'public',
                        table,
                        filter,
                    }],
                });
            }
        }

        return topic;
    }

    /**
     * Subscribe to new messages in specific conversations.
     * @param {string[]} conversationIds
     * @param {Function} callback — Called with new message records
     */
    subscribeToMessages(conversationIds, callback) {
        for (const convId of conversationIds) {
            this.subscribeToChanges('messages', `conversation_id=eq.${convId}`, 'INSERT', (payload) => {
                callback(payload.record);
            });
        }
    }

    /**
     * Subscribe to workspace state changes.
     * @param {string} workspaceId
     * @param {Function} callback — Called with updated workspace record
     */
    subscribeToWorkspace(workspaceId, callback) {
        this.subscribeToChanges('workspaces', `id=eq.${workspaceId}`, 'UPDATE', (payload) => {
            callback(payload.record);
        });
    }

    /**
     * Unsubscribe from a channel.
     * @param {string} topic
     */
    unsubscribe(topic) {
        this._channelCallbacks.delete(topic);
        this._joinedChannels.delete(topic);

        if (this._connected) {
            this._send(topic, 'phx_leave', {});
        }
    }

    /**
     * Unsubscribe from all channels.
     */
    unsubscribeAll() {
        for (const topic of this._joinedChannels) {
            if (this._connected) {
                this._send(topic, 'phx_leave', {});
            }
        }
        this._joinedChannels.clear();
        this._channelCallbacks.clear();
    }

    // ── Presence ──────────────────────────────────────────────────────────

    /**
     * Join a presence channel for a workspace.
     * @param {string} workspaceId
     * @param {object} userInfo — { user_id, display_name, avatar_url, status }
     * @param {Function} onPresenceChange — Called with array of online members
     */
    joinPresence(workspaceId, userInfo, onPresenceChange) {
        const topic = `realtime:presence:workspace:${workspaceId}`;

        if (!this._channelCallbacks.has(topic)) {
            this._channelCallbacks.set(topic, []);
        }
        this._channelCallbacks.get(topic).push(onPresenceChange);

        this._joinedChannels.add(topic);
        if (this._connected) {
            this._send(topic, 'phx_join', {
                config: {
                    presence: { key: userInfo.user_id },
                },
            });

            // Track our presence
            this._send(topic, 'presence', {
                type: 'track',
                payload: userInfo,
            });
        }
    }

    // ── Broadcast ─────────────────────────────────────────────────────────

    /**
     * Broadcast an ephemeral event to all participants in a workspace.
     * @param {string} workspaceId
     * @param {string} event — e.g. 'typing', 'cursor_move'
     * @param {object} payload
     */
    broadcast(workspaceId, event, payload) {
        const topic = `realtime:broadcast:workspace:${workspaceId}`;
        if (this._connected) {
            this._send(topic, 'broadcast', {
                type: 'broadcast',
                event,
                payload,
            });
        }
    }

    // ── Internal Methods ──────────────────────────────────────────────────

    /**
     * Send Phoenix auth message after connecting.
     */
    _authenticate() {
        if (!this.accessToken || !this._connected) return;
        this._send('realtime:auth', 'access_token', {
            access_token: this.accessToken,
        });
    }

    /**
     * Send a Phoenix Channel join message.
     * @param {string} topic
     * @param {object} [config]
     */
    _sendJoin(topic, config = {}) {
        this._send(topic, 'phx_join', { config });
    }

    /**
     * Send a Phoenix Channel message.
     * @param {string} topic
     * @param {string} event
     * @param {object} payload
     */
    _send(topic, event, payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const msg = JSON.stringify({
            topic,
            event,
            payload,
            ref: String(++this._ref),
        });

        try {
            this.ws.send(msg);
        } catch {
            // Ignore send errors — will reconnect
        }
    }

    /**
     * Handle an incoming Phoenix Channel message.
     * @param {{ topic: string, event: string, payload: object }} msg
     */
    _handleMessage(msg) {
        const { topic, event, payload } = msg;

        // Heartbeat reply — ignore
        if (topic === 'phoenix' && event === 'phx_reply') return;

        // Channel join reply
        if (event === 'phx_reply') return;

        // Postgres Changes
        if (event === 'postgres_changes') {
            const data = payload?.data;
            if (data) {
                const callbacks = this._channelCallbacks.get(topic);
                if (callbacks) {
                    for (const cb of callbacks) {
                        try { cb(data); } catch { /* ignore callback errors */ }
                    }
                }

                // Also emit on eventBus for general consumption
                if (this.eventBus && data.type === 'INSERT' && data.table === 'messages') {
                    this.eventBus.emitTyped('cloud:message:received', data.record);
                }
                if (this.eventBus && data.type === 'UPDATE' && data.table === 'workspaces') {
                    this.eventBus.emitTyped('cloud:workspace:remote-update', data.record);
                }
            }
            return;
        }

        // Presence events
        if (event === 'presence_state' || event === 'presence_diff') {
            const callbacks = this._channelCallbacks.get(topic);
            if (callbacks) {
                for (const cb of callbacks) {
                    try { cb(payload); } catch { /* ignore */ }
                }
            }
            if (this.eventBus) {
                this.eventBus.emitTyped('cloud:presence:updated', payload);
            }
            return;
        }

        // Broadcast events
        if (event === 'broadcast') {
            if (this.eventBus && payload?.event) {
                this.eventBus.emitTyped(`cloud:broadcast:${payload.event}`, payload.payload);
            }
            return;
        }
    }

    /**
     * Start the heartbeat timer.
     */
    _startHeartbeat() {
        this._stopHeartbeat();
        this._heartbeatTimer = setInterval(() => {
            this._send('phoenix', 'heartbeat', {});
        }, HEARTBEAT_INTERVAL);

        if (this._heartbeatTimer.unref) {
            this._heartbeatTimer.unref();
        }
    }

    /**
     * Stop the heartbeat timer.
     */
    _stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    /**
     * Schedule a reconnection attempt with exponential backoff.
     */
    _scheduleReconnect() {
        const delay = Math.min(
            RECONNECT_BASE_DELAY * Math.pow(1.5, this._reconnectAttempts),
            RECONNECT_MAX_DELAY
        );
        this._reconnectAttempts++;

        setTimeout(() => {
            if (!this._intentionalClose) {
                this.connect().catch(() => {
                    // Will retry via close handler
                });
            }
        }, delay);
    }

    /**
     * Update the access token (e.g. after refresh).
     * @param {string} newToken
     */
    updateAccessToken(newToken) {
        this.accessToken = newToken;
        if (this._connected) {
            this._authenticate();
        }
    }
}
