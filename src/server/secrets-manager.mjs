// Secrets Manager — Encrypted at-rest secrets storage
// See SECRETS_DESIGN.md for full architecture documentation
//
// Encryption: AES-256-GCM with machine-derived key (Node.js crypto, zero deps)
// File format: [16B IV][16B authTag][...ciphertext...]
// Plaintext: JSON { version: 1, secrets: { [name]: SecretEntry } }

import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Known Secret Definitions ────────────────────────────────────────────

export const KNOWN_SECRETS = [
    {
        name: 'OPENAI_API_KEY',
        category: 'AI Providers',
        description: 'OpenAI API key for GPT-4o and other OpenAI models',
        required: false,
    },
    {
        name: 'ANTHROPIC_API_KEY',
        category: 'AI Providers',
        description: 'Anthropic API key for Claude models',
        required: false,
    },
    {
        name: 'GOOGLE_API_KEY',
        category: 'AI Providers',
        description: 'Google API key for Gemini models',
        required: false,
    },
    {
        name: 'ELEVENLABS_API_KEY',
        category: 'Integrations',
        description: 'ElevenLabs API key for text-to-speech',
        required: false,
    },
    {
        name: 'SERPER_API_KEY',
        category: 'Integrations',
        description: 'Serper API key for web search',
        required: false,
    },
    {
        name: 'OPENCLAW_AUTH_TOKEN',
        category: 'Integrations',
        description: 'OpenClaw gateway authentication token',
        required: false,
    },
    {
        name: 'OPENCLAW_URL',
        category: 'Endpoints',
        description: 'OpenClaw WebSocket URL (e.g. ws://127.0.0.1:18789)',
        required: false,
    },
    {
        name: 'OPENCLAW_PATH',
        category: 'Endpoints',
        description: 'Path to the OpenClaw binary on this machine',
        required: false,
    },
    {
        name: 'OPENCLAW_MODE',
        category: 'Integrations',
        description: 'OpenClaw integration mode (external or integrated)',
        required: false,
    },
    {
        name: 'AI_ENDPOINT',
        category: 'Endpoints',
        description: 'Custom AI endpoint URL for local or proxy models',
        required: false,
    },
    {
        name: 'OBOTO_CLOUD_URL',
        category: 'Integrations',
        description: 'Oboto Cloud base URL for sync, collaboration, and cloud AI agents',
        required: false,
    },
    {
        name: 'OBOTO_CLOUD_KEY',
        category: 'Integrations',
        description: 'Oboto Cloud anonymous/public key for API authentication',
        required: false,
    },
];

const CATEGORIES = ['AI Providers', 'Integrations', 'Endpoints', 'Custom'];

// ─── SecretsManager ──────────────────────────────────────────────────────

export class SecretsManager {
    /**
     * @param {string} [workspaceDir] - Optional workspace directory.
     *   The .secrets.enc file is stored at the Oboto project root,
     *   NOT in the user's workspace.
     */
    constructor(workspaceDir) {
        // Store at project root (two levels up from src/server/)
        this._projectRoot = path.resolve(__dirname, '..', '..');
        this._filePath = path.join(this._projectRoot, '.secrets.enc');
        this._backupPath = path.join(this._projectRoot, '.secrets.enc.bak');
        this._tmpPath = path.join(this._projectRoot, '.secrets.enc.tmp');
        this._store = { version: 1, secrets: {} };
        this._key = this._deriveKey();
    }

    // ── Key Derivation ───────────────────────────────────────────────────

    /**
     * Derive the encryption key from machine-specific data.
     * Uses crypto.scryptSync with a machine fingerprint as password
     * and a deterministic salt derived from the fingerprint.
     * @returns {Buffer} 32-byte encryption key
     */
    _deriveKey() {
        // Build machine fingerprint
        const fingerprint = `${os.hostname()}|${os.userInfo().username}|${os.homedir()}`;
        const fingerprintHash = crypto.createHash('sha256').update(fingerprint).digest();
        // Use first 16 bytes of fingerprint hash as salt
        const salt = fingerprintHash.subarray(0, 16);
        // Derive 32-byte key using scrypt
        return crypto.scryptSync(fingerprintHash, salt, 32);
    }

    // ── Encryption / Decryption ──────────────────────────────────────────

    /**
     * Encrypt plaintext JSON and write to .secrets.enc atomically.
     * @param {object} store - The secrets store object
     * @returns {Promise<void>}
     */
    async _save(store) {
        const plaintext = JSON.stringify(store, null, 2);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);

        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag(); // 16 bytes

        // File format: [16B IV][16B authTag][...ciphertext...]
        const fileBuffer = Buffer.concat([iv, authTag, encrypted]);

        // Atomic write: write to tmp, then rename
        await fs.promises.writeFile(this._tmpPath, fileBuffer);
        await fs.promises.rename(this._tmpPath, this._filePath);
    }

    /**
     * Read .secrets.enc from disk and decrypt.
     * @returns {object|null} The decrypted store, or null if file doesn't exist
     * @throws {Error} If decryption fails (wrong machine, corrupt file)
     */
    async _read() {
        try {
            await fs.promises.access(this._filePath);
        } catch {
            return null; // File doesn't exist
        }

        const fileBuffer = await fs.promises.readFile(this._filePath);

        if (fileBuffer.length < 33) {
            throw new Error('Secrets file is corrupted (too small)');
        }

        const iv = fileBuffer.subarray(0, 16);
        const authTag = fileBuffer.subarray(16, 32);
        const ciphertext = fileBuffer.subarray(32);

        const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
        decipher.setAuthTag(authTag);

        let plaintext;
        try {
            plaintext = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]).toString('utf8');
        } catch (err) {
            throw new Error(
                `Failed to decrypt secrets file. This may happen if the file was created on a different machine. Original error: ${err.message}`
            );
        }

        return JSON.parse(plaintext);
    }

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Load and decrypt secrets from .secrets.enc.
     * If the file does not exist, initializes an empty store.
     * If decryption fails, backs up the corrupt file and starts fresh.
     * @returns {Promise<void>}
     */
    async load() {
        try {
            const store = await this._read();
            if (store) {
                this._store = store;
                console.log(`[SecretsManager] Loaded ${Object.keys(store.secrets).length} secret(s) from vault`);
            } else {
                console.log('[SecretsManager] No secrets file found — starting with empty vault');
            }
        } catch (err) {
            console.warn(`[SecretsManager] ${err.message}`);
            // Backup corrupt file
            try {
                await fs.promises.copyFile(this._filePath, this._backupPath);
                console.warn(`[SecretsManager] Corrupt file backed up to .secrets.enc.bak`);
            } catch {
                // Ignore backup failures
            }
            this._store = { version: 1, secrets: {} };
        }
    }

    /**
     * Merge loaded secrets into process.env.
     * Vault secrets OVERRIDE existing env vars (including .env values).
     * This should be called BEFORE dotenv.config() for proper precedence.
     */
    applyToEnv() {
        for (const [name, entry] of Object.entries(this._store.secrets)) {
            process.env[name] = entry.value;
        }
    }

    /**
     * List all secret names with metadata (no values).
     * Returns both stored secrets and known secret definitions,
     * marking which are configured vs unconfigured.
     * @returns {Array<{name: string, category: string, description: string, isConfigured: boolean, source: string, updatedAt: string|null}>}
     */
    list() {
        const result = [];
        const seen = new Set();

        // First, include all known secrets (preserving order)
        for (const known of KNOWN_SECRETS) {
            seen.add(known.name);
            const vaultEntry = this._store.secrets[known.name];
            const envValue = process.env[known.name];

            let source = 'none';
            let isConfigured = false;
            let updatedAt = null;

            if (vaultEntry) {
                source = 'vault';
                isConfigured = true;
                updatedAt = vaultEntry.updatedAt || null;
            } else if (envValue) {
                source = 'env';
                isConfigured = true;
            }

            result.push({
                name: known.name,
                category: known.category,
                description: vaultEntry?.description || known.description,
                isConfigured,
                source,
                updatedAt,
            });
        }

        // Then, include any custom secrets stored in the vault but not in KNOWN_SECRETS
        for (const [name, entry] of Object.entries(this._store.secrets)) {
            if (seen.has(name)) continue;
            seen.add(name);

            result.push({
                name,
                category: entry.category || 'Custom',
                description: entry.description || '',
                isConfigured: true,
                source: 'vault',
                updatedAt: entry.updatedAt || null,
            });
        }

        return result;
    }

    /**
     * Get a single secret value by name.
     * Checks vault first, then falls back to process.env.
     * @param {string} name - The secret name
     * @returns {string|null} The secret value or null if not found
     */
    get(name) {
        const entry = this._store.secrets[name];
        if (entry) return entry.value;
        return process.env[name] || null;
    }

    /**
     * Set or update a secret.
     * Persists to disk and updates process.env immediately.
     * @param {string} name - The secret name
     * @param {string} value - The secret value
     * @param {string} [category='Custom'] - Category grouping
     * @param {string} [description=''] - Human-readable description
     * @returns {Promise<void>}
     */
    async set(name, value, category, description) {
        if (!name || typeof name !== 'string') {
            throw new Error('Secret name is required');
        }
        if (value === undefined || value === null) {
            throw new Error('Secret value is required');
        }

        const now = new Date().toISOString();
        const existing = this._store.secrets[name];

        // Look up known secret for default category/description
        const knownDef = KNOWN_SECRETS.find(k => k.name === name);

        this._store.secrets[name] = {
            value: String(value),
            category: category || existing?.category || knownDef?.category || 'Custom',
            description: description || existing?.description || knownDef?.description || '',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        // Persist to disk
        await this._save(this._store);

        // Update process.env immediately for live effect
        process.env[name] = String(value);
    }

    /**
     * Delete a secret by name.
     * Removes from vault and process.env.
     * @param {string} name - The secret name
     * @returns {Promise<boolean>} true if deleted, false if not found
     */
    async delete(name) {
        if (!this._store.secrets[name]) {
            return false;
        }

        delete this._store.secrets[name];
        await this._save(this._store);

        // Remove from process.env
        delete process.env[name];

        return true;
    }

    /**
     * Check if a secret is configured (has a value either from vault or env).
     * @param {string} name
     * @returns {boolean}
     */
    isConfigured(name) {
        return !!(this._store.secrets[name]?.value || process.env[name]);
    }

    /**
     * Get the list of category names.
     * @returns {string[]}
     */
    getCategories() {
        return [...CATEGORIES];
    }
}
