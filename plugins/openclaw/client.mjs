/**
 * OpenClaw Client
 *
 * Connects to an OpenClaw Gateway via WebSocket. Implements the protocol
 * handshake (connect.challenge → connect → hello-ok) with Ed25519 device
 * identity authentication.
 *
 * Ported from src/integration/openclaw/client.mjs.
 *
 * @module @oboto/plugin-openclaw/client
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Device Identity helpers ──────────────────────────────────────────────

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const IDENTITY_DIR = path.join(os.homedir(), '.openclaw', 'identity');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'device.json');

function base64UrlEncode(buf) {
    return buf
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
    const key = crypto.createPublicKey(publicKeyPem);
    const spki = key.export({ type: 'spki', format: 'der' });
    if (
        spki.length === ED25519_SPKI_PREFIX.length + 32 &&
        spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ) {
        return spki.subarray(ED25519_SPKI_PREFIX.length);
    }
    return spki;
}

function fingerprintPublicKey(publicKeyPem) {
    const raw = derivePublicKeyRaw(publicKeyPem);
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateIdentity() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const deviceId = fingerprintPublicKey(publicKeyPem);
    return { deviceId, publicKeyPem, privateKeyPem };
}

function loadOrCreateDeviceIdentity(filePath = IDENTITY_FILE) {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (
                parsed?.version === 1 &&
                typeof parsed.deviceId === 'string' &&
                typeof parsed.publicKeyPem === 'string' &&
                typeof parsed.privateKeyPem === 'string'
            ) {
                const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
                if (derivedId && derivedId !== parsed.deviceId) {
                    const updated = { ...parsed, deviceId: derivedId };
                    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n', {
                        mode: 0o600
                    });
                    try {
                        fs.chmodSync(filePath, 0o600);
                    } catch {
                        /* best-effort */
                    }
                    return {
                        deviceId: derivedId,
                        publicKeyPem: parsed.publicKeyPem,
                        privateKeyPem: parsed.privateKeyPem
                    };
                }
                return {
                    deviceId: parsed.deviceId,
                    publicKeyPem: parsed.publicKeyPem,
                    privateKeyPem: parsed.privateKeyPem
                };
            }
        }
    } catch {
        // fall through to regenerate
    }

    const identity = generateIdentity();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stored = {
        version: 1,
        deviceId: identity.deviceId,
        publicKeyPem: identity.publicKeyPem,
        privateKeyPem: identity.privateKeyPem,
        createdAtMs: Date.now()
    };
    fs.writeFileSync(filePath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        /* best-effort */
    }
    return identity;
}

function signDevicePayload(privateKeyPem, payload) {
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
    return base64UrlEncode(sig);
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
    return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

// ── Device Auth Payload ──────────────────────────────────────────────────

function buildDeviceAuthPayload({
    deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs,
    token,
    nonce
}) {
    const version = nonce ? 'v2' : 'v1';
    const scopeStr = scopes.join(',');
    const tokenStr = token || '';
    const base = [
        version,
        deviceId,
        clientId,
        clientMode,
        role,
        scopeStr,
        String(signedAtMs),
        tokenStr
    ];
    if (version === 'v2') {
        base.push(nonce || '');
    }
    return base.join('|');
}

// ── Device Auth Token Store ──────────────────────────────────────────────

function resolveDeviceAuthPath() {
    return path.join(IDENTITY_DIR, 'device-auth.json');
}

function loadDeviceAuthToken(deviceId, role) {
    const filePath = resolveDeviceAuthPath();
    try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || parsed.deviceId !== deviceId) return null;
        const entry = parsed.tokens?.[role];
        if (!entry || typeof entry.token !== 'string') return null;
        return entry;
    } catch {
        return null;
    }
}

function storeDeviceAuthToken(deviceId, role, token, scopes = []) {
    const filePath = resolveDeviceAuthPath();
    let existing = null;
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            existing = JSON.parse(raw);
            if (existing?.version !== 1 || existing.deviceId !== deviceId) existing = null;
        }
    } catch {
        /* ignore */
    }

    const next = {
        version: 1,
        deviceId,
        tokens: existing?.tokens ? { ...existing.tokens } : {}
    };
    next.tokens[role] = {
        token,
        role,
        scopes: [...new Set(scopes.filter((s) => s.trim()))].sort(),
        updatedAtMs: Date.now()
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        /* best-effort */
    }
}

// ── Constants ────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 3;
const CLIENT_ID = 'gateway-client';
const CLIENT_MODE = 'backend';
const CLIENT_VERSION = '1.0.0';
const ROLE = 'operator';
const SCOPES = ['operator.admin'];

// ── OpenClawClient ───────────────────────────────────────────────────────

/**
 * WebSocket client for connecting to OpenClaw Gateway.
 * Implements the protocol: connect.challenge → connect → hello-ok
 * with Ed25519 device identity authentication.
 */
export class OpenClawClient extends EventEmitter {
    /**
     * @param {string} url — WebSocket URL (e.g. ws://127.0.0.1:18789)
     * @param {string} [authToken] — Authentication token (optional)
     */
    constructor(url, authToken) {
        super();
        this.url = url || 'ws://127.0.0.1:18789';
        this.authToken = authToken;
        this.ws = null;
        this.pendingRequests = new Map();
        this.isConnected = false;
        this._connectionPromise = null;
        this.deviceIdentity = loadOrCreateDeviceIdentity();
    }

    /**
     * Connects to the OpenClaw Gateway and performs handshake.
     * @returns {Promise<void>}
     */
    async connect() {
        if (this.isConnected) return;
        if (this._connectionPromise) return this._connectionPromise;

        this._connectionPromise = new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url, { maxPayload: 25 * 1024 * 1024 });
            } catch (err) {
                this._connectionPromise = null;
                return reject(err);
            }

            const timeout = setTimeout(() => {
                if (!this.isConnected) {
                    this.disconnect();
                    reject(new Error('Connection timeout during handshake'));
                }
            }, 10000);

            this.ws.on('open', () => {
                // Wait for connect.challenge event from the server
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());

                    // 1. Handle Challenge → Send Connect with device identity
                    if (msg.type === 'event' && msg.event === 'connect.challenge') {
                        const nonce = msg.payload?.nonce || null;
                        const requestId = crypto.randomUUID();

                        const storedToken = loadDeviceAuthToken(
                            this.deviceIdentity.deviceId,
                            ROLE
                        )?.token;
                        const authTokenVal = storedToken || this.authToken || undefined;
                        const signedAtMs = Date.now();

                        const payload = buildDeviceAuthPayload({
                            deviceId: this.deviceIdentity.deviceId,
                            clientId: CLIENT_ID,
                            clientMode: CLIENT_MODE,
                            role: ROLE,
                            scopes: SCOPES,
                            signedAtMs,
                            token: authTokenVal || null,
                            nonce
                        });
                        const signature = signDevicePayload(
                            this.deviceIdentity.privateKeyPem,
                            payload
                        );

                        const device = {
                            id: this.deviceIdentity.deviceId,
                            publicKey: publicKeyRawBase64UrlFromPem(
                                this.deviceIdentity.publicKeyPem
                            ),
                            signature,
                            signedAt: signedAtMs,
                            nonce: nonce || undefined
                        };

                        const auth = authTokenVal ? { token: authTokenVal } : undefined;

                        const connectParams = {
                            minProtocol: PROTOCOL_VERSION,
                            maxProtocol: PROTOCOL_VERSION,
                            client: {
                                id: CLIENT_ID,
                                version: CLIENT_VERSION,
                                platform: process.platform,
                                mode: CLIENT_MODE,
                                instanceId: crypto.randomUUID()
                            },
                            caps: [],
                            role: ROLE,
                            scopes: SCOPES,
                            device,
                            auth
                        };

                        const connectReq = {
                            type: 'req',
                            id: requestId,
                            method: 'connect',
                            params: connectParams
                        };

                        this.pendingRequests.set(requestId, {
                            resolve: (helloOk) => {
                                clearTimeout(timeout);
                                this.isConnected = true;
                                this._connectionPromise = null;

                                const authInfo = helloOk?.auth;
                                if (authInfo?.deviceToken && this.deviceIdentity) {
                                    storeDeviceAuthToken(
                                        this.deviceIdentity.deviceId,
                                        authInfo.role || ROLE,
                                        authInfo.deviceToken,
                                        authInfo.scopes || []
                                    );
                                }

                                this.emit('connected');
                                resolve(helloOk);
                            },
                            reject: (err) => {
                                clearTimeout(timeout);
                                this._connectionPromise = null;
                                reject(err);
                            }
                        });

                        this.ws.send(JSON.stringify(connectReq));
                        return;
                    }

                    // 2. Handle Responses
                    if (msg.type === 'res') {
                        const req = this.pendingRequests.get(msg.id);
                        if (req) {
                            this.pendingRequests.delete(msg.id);
                            if (msg.ok) {
                                req.resolve(msg.payload);
                            } else {
                                req.reject(new Error(msg.error?.message || 'Request failed'));
                            }
                        }
                        return;
                    }

                    // 3. Handle Events
                    if (msg.type === 'event') {
                        this.emit('event', msg.event, msg.payload);
                    }
                } catch (err) {
                    console.error('[OpenClawClient] Message parsing error:', err);
                }
            });

            this.ws.on('error', (err) => {
                console.error('[OpenClawClient] Socket error:', err);
                if (!this.isConnected) {
                    clearTimeout(timeout);
                    this._connectionPromise = null;
                    reject(err);
                }
                this.emit('error', err);
            });

            this.ws.on('close', () => {
                this.isConnected = false;
                this._connectionPromise = null;
                this.emit('disconnected');

                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error('Connection closed'));
                }
                this.pendingRequests.clear();
            });
        });

        return this._connectionPromise;
    }

    /**
     * Sends a request to OpenClaw.
     * @param {string} method
     * @param {object} params
     * @returns {Promise<unknown>}
     */
    async sendRequest(method, params) {
        if (!this.isConnected) {
            throw new Error('Not connected to OpenClaw');
        }

        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            const req = { type: 'req', id, method, params };

            this.pendingRequests.set(id, { resolve, reject });

            try {
                this.ws.send(JSON.stringify(req));
            } catch (err) {
                this.pendingRequests.delete(id);
                reject(err);
            }

            // Default request timeout (30s)
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout for method ${method}`));
                }
            }, 30000);
        });
    }

    /**
     * Disconnect from the gateway.
     */
    disconnect() {
        if (this.ws) {
            try {
                this.ws.terminate();
            } catch {
                // Ignore errors during termination
            }
            this.ws = null;
        }
        this.isConnected = false;
    }
}
