/**
 * Support LLM Transport Implementations
 *
 * Provides the transport layer for the invisible Support LLM subsystem.
 * Each transport implements the SupportTransport interface:
 *   - probe(): Promise<CapabilitySet|null>
 *   - generate(request): Promise<Response>
 *   - isReady(): boolean
 *   - destroy(): void
 *
 * @see docs/architecture/invisible-local-llm-integration.md §3.1, §4.3
 */

import { consoleStyler } from '../ui/console-styler.mjs';

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Generate a unique request ID for correlating request/response pairs. */
function makeRequestId() {
    return `sllm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── WebLLMTransport ────────────────────────────────────────────────────────

/**
 * Routes Support LLM requests to a browser-hosted WebLLM engine via EventBus.
 *
 * Uses the `webllm:support:*` event namespace to avoid conflicts with the
 * primary WebLLM provider bridge (`webllm:generate` / `webllm:response`).
 *
 * Lifecycle:
 *   1. Backend emits `webllm:support:probe` → browser responds with
 *      `webllm:support:ready` (capabilities) or `webllm:support:unavailable`.
 *   2. Backend emits `webllm:support:generate` → browser runs inference →
 *      responds with `webllm:support:response`.
 *   3. Browser periodically sends `webllm:support:status` heartbeats.
 */
export class WebLLMTransport {
    /**
     * @param {object} eventBus - The application EventBus instance.
     * @param {object} [options]
     * @param {number} [options.probeTimeoutMs=5000]  Timeout for capability probe.
     * @param {number} [options.requestTimeoutMs=10000] Per-request timeout.
     * @param {number} [options.heartbeatIntervalMs=30000] Expected heartbeat interval.
     * @param {number} [options.maxMissedHeartbeats=2] Missed heartbeats before marking unavailable.
     */
    constructor(eventBus, options = {}) {
        this._eventBus = eventBus;
        this._pending = new Map(); // requestId → { resolve, reject, timer }
        this._ready = false;
        this._capabilities = null;
        this._destroyed = false;

        // Timeouts
        this._probeTimeoutMs = options.probeTimeoutMs ?? 5000;
        this._requestTimeoutMs = options.requestTimeoutMs ?? 10000;
        this._heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
        this._maxMissedHeartbeats = options.maxMissedHeartbeats ?? 2;

        // Heartbeat tracking
        this._missedHeartbeats = 0;
        this._heartbeatTimer = null;

        // Bind event handlers so we can remove them on destroy
        this._onResponse = this._handleResponse.bind(this);
        this._onReady = this._handleReady.bind(this);
        this._onUnavailable = this._handleUnavailable.bind(this);
        this._onStatus = this._handleStatus.bind(this);

        // Register listeners
        this._eventBus.on('webllm:support:response', this._onResponse);
        this._eventBus.on('webllm:support:ready', this._onReady);
        this._eventBus.on('webllm:support:unavailable', this._onUnavailable);
        this._eventBus.on('webllm:support:status', this._onStatus);
    }

    // ── SupportTransport interface ──────────────────────────────────────

    /**
     * Probe the browser for WebGPU + WebLLM engine availability.
     *
     * The probe succeeds if the browser replies with:
     *   - `webllm:support:ready`  → engine loaded, resolve with capabilities.
     *   - `webllm:support:status` → engine is alive but still initialising /
     *     downloading.  We treat this as "client exists" and resolve with a
     *     synthetic capability set so the caller keeps this transport rather
     *     than falling back.  The persistent `_onReady` listener (registered
     *     in the constructor) will flip `_ready` once the engine finishes.
     *   - `webllm:support:unavailable` → no WebGPU, resolve null.
     *
     * @returns {Promise<object|null>} Capability set, or null if unavailable.
     */
    async probe() {
        if (this._destroyed) return null;

        return new Promise((resolve) => {
            const cleanup = () => {
                clearTimeout(timer);
                this._eventBus.off('webllm:support:ready', onReady);
                this._eventBus.off('webllm:support:unavailable', onUnavail);
                this._eventBus.off('webllm:support:status', onStatus);
            };

            const timer = setTimeout(() => {
                cleanup();
                consoleStyler.log('info', '🧠 SupportLLM: WebLLM probe timed out — no browser client with WebGPU.');
                resolve(null);
            }, this._probeTimeoutMs);

            // One-shot listeners for probe result
            const onReady = (data) => {
                cleanup();
                this._capabilities = data;
                this._ready = true;
                this._startHeartbeatMonitor();
                consoleStyler.log('info', `🧠 SupportLLM: WebLLM ready — model: ${data?.model || 'unknown'}`);
                resolve(data);
            };

            const onUnavail = (data) => {
                cleanup();
                consoleStyler.log('info', `🧠 SupportLLM: WebLLM unavailable — ${data?.reason || 'no WebGPU'}`);
                resolve(null);
            };

            // The browser client exists and is downloading / initialising.
            // Return a synthetic "initialising" capability set so the caller
            // keeps this transport alive.  The constructor's persistent
            // `_onReady` handler will flip `_ready = true` once the engine
            // finishes loading.
            const onStatus = (data) => {
                cleanup();
                const syntheticCaps = {
                    model: data?.model || 'pending',
                    contextLength: 0,
                    quantisation: 'unknown',
                    webgpu: true,
                    initialising: true,
                    state: data?.state || 'downloading',
                    progress: data?.progress ?? 0,
                };
                this._capabilities = syntheticCaps;
                // NOT marking _ready = true — generation requests should wait
                // until the real `ready` event arrives via the persistent handler.
                this._startHeartbeatMonitor();
                consoleStyler.log(
                    'info',
                    `🧠 SupportLLM: WebLLM client alive — ${data?.state || 'initialising'} (${data?.progress ?? 0}%). Waiting for engine…`,
                );
                resolve(syntheticCaps);
            };

            this._eventBus.on('webllm:support:ready', onReady);
            this._eventBus.on('webllm:support:unavailable', onUnavail);
            this._eventBus.on('webllm:support:status', onStatus);

            // Send probe request to browser
            this._eventBus.emitTyped('webllm:support:probe', { timestamp: Date.now() });
        });
    }

    /**
     * Send a generation request to the browser WebLLM engine.
     * @param {object} request - { messages, temperature, max_tokens, response_format? }
     * @returns {Promise<object|null>} Completion result or null on failure.
     */
    async generate(request) {
        if (this._destroyed || !this._ready) return null;

        const requestId = makeRequestId();

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this._pending.delete(requestId);
                consoleStyler.log('warning', `🧠 SupportLLM: request ${requestId} timed out after ${this._requestTimeoutMs}ms`);
                resolve(null);
            }, this._requestTimeoutMs);

            this._pending.set(requestId, { resolve, timer });

            this._eventBus.emitTyped('webllm:support:generate', {
                requestId,
                messages: request.messages,
                temperature: request.temperature ?? 0.1,
                max_tokens: request.max_tokens ?? 256,
                response_format: request.response_format || undefined,
            });
        });
    }

    /** @returns {boolean} Whether this transport is ready for requests. */
    isReady() {
        return this._ready && !this._destroyed;
    }

    /** @returns {object|null} Capabilities reported by the browser. */
    getCapabilities() {
        return this._capabilities;
    }

    /** Tear down listeners and pending requests. */
    destroy() {
        this._destroyed = true;
        this._ready = false;

        // Clear heartbeat monitor
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }

        // Reject all pending requests
        for (const [id, entry] of this._pending) {
            clearTimeout(entry.timer);
            entry.resolve(null);
        }
        this._pending.clear();

        // Remove event listeners
        if (this._eventBus) {
            this._eventBus.off('webllm:support:response', this._onResponse);
            this._eventBus.off('webllm:support:ready', this._onReady);
            this._eventBus.off('webllm:support:unavailable', this._onUnavailable);
            this._eventBus.off('webllm:support:status', this._onStatus);
        }
    }

    // ── Internal handlers ───────────────────────────────────────────────

    /** Handle a generation response from the browser. */
    _handleResponse(data) {
        const entry = this._pending.get(data?.requestId);
        if (!entry) return;

        clearTimeout(entry.timer);
        this._pending.delete(data.requestId);

        if (data.error) {
            consoleStyler.log('warning', `🧠 SupportLLM: response error — ${data.error}`);
            entry.resolve(null);
        } else {
            entry.resolve(data.result ?? null);
        }
    }

    /** Handle a ready announcement (browser loaded the engine). */
    _handleReady(data) {
        this._capabilities = data;
        this._ready = true;
        this._missedHeartbeats = 0;
        this._startHeartbeatMonitor();
        consoleStyler.log('info', `🧠 SupportLLM: WebLLM came online — model: ${data?.model || 'unknown'}`);
    }

    /** Handle an unavailable announcement. */
    _handleUnavailable() {
        this._ready = false;
        this._capabilities = null;
    }

    /** Handle a heartbeat status ping from the browser. */
    _handleStatus() {
        this._missedHeartbeats = 0;
    }

    /** Start (or restart) the heartbeat monitor interval. */
    _startHeartbeatMonitor() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);

        this._missedHeartbeats = 0;
        this._heartbeatTimer = setInterval(() => {
            this._missedHeartbeats++;
            if (this._missedHeartbeats >= this._maxMissedHeartbeats) {
                consoleStyler.log('warning', '🧠 SupportLLM: WebLLM heartbeat lost — marking unavailable.');
                this._ready = false;
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
            }
        }, this._heartbeatIntervalMs);
    }
}


// ── FallbackTransport ──────────────────────────────────────────────────────

/**
 * Stub transport that always reports unavailable.
 * When the SupportLLM has no working transport, callers receive `null` from
 * every method and gracefully fall back to their existing behaviour.
 */
export class FallbackTransport {
    constructor() {
        this._ready = false;
    }

    async probe() {
        return null;
    }

    async generate() {
        return null;
    }

    isReady() {
        return false;
    }

    destroy() {
        // Nothing to clean up
    }
}
