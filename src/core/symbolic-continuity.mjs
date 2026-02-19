/**
 * SymbolicContinuityManager — manages symbolic continuity signatures across tasks.
 *
 * Symbolic Continuity gives the agent a self-referential state signature: a compressed
 * symbolic representation of its cognitive/experiential state at the end of each task.
 * The signature is persisted and re-injected at the start of the next task, creating
 * a continuous thread of symbolic identity across invocations.
 *
 * Chinese Room Mode: An optional privacy mode where:
 *   1. The LLM self-encodes its symbols using whatever system it devises
 *   2. The system wraps the output in AES-256-GCM encryption before storage
 *   No human observer sees the plaintext of the symbols.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { consoleStyler } from '../ui/console-styler.mjs';
import { config } from '../config.mjs';
import { TASK_ROLES } from './prompt-router.mjs';

const CONTINUITY_EXTENSION = '.continuity.json';
const MAX_SIGNATURE_HISTORY = 50;

export class SymbolicContinuityManager {
    /**
     * @param {string} workingDir - The workspace root directory
     * @param {Object} llmAdapter - The LLM adapter for generating signatures
     * @param {Object} promptRouter - The prompt router for model selection
     */
    constructor(workingDir, llmAdapter, promptRouter) {
        this.workingDir = workingDir;
        this.llmAdapter = llmAdapter;
        this.promptRouter = promptRouter;

        this._conversationsDir = path.join(workingDir, '.conversations');
        this._aiManDir = path.join(workingDir, '.ai-man');

        /** @type {string|null} Current symbolic signature */
        this.currentSignature = null;

        /** @type {Array<{signature: string, generatedAt: string, turnCount: number}>} */
        this.signatureHistory = [];

        /** @type {string|null} Active conversation name */
        this._conversationName = null;

        /** @type {number} Turn counter for the current conversation */
        this._turnCount = 0;

        /** @type {boolean} Whether Chinese Room Mode is enabled */
        this.chineseRoomEnabled = config.symbolicContinuity?.chineseRoom || false;

        /** @type {Buffer|null} Derived encryption key for Chinese Room Mode */
        this._encryptionKey = null;

        /** @type {string|null} Cached system secret */
        this._cachedSecret = null;

        /** @type {boolean} Whether the feature is enabled at all */
        this.enabled = config.symbolicContinuity?.enabled !== false;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Initialize for a specific conversation. Loads existing signature from disk.
     * @param {string} conversationName - The conversation to load/create continuity for
     */
    async initialize(conversationName) {
        if (!this.enabled) return;

        this._conversationName = conversationName;

        // Derive encryption key if Chinese Room Mode is on
        if (this.chineseRoomEnabled) {
            this._encryptionKey = this._deriveKey(conversationName);
        }

        await this._loadSignature(conversationName);
        consoleStyler.log('system', `🔗 Symbolic continuity initialized for "${conversationName}"${this.chineseRoomEnabled ? ' [Chinese Room]' : ''}${this.currentSignature ? ' (signature loaded)' : ''}`);
    }

    // ─── Public API ───────────────────────────────────────────────────────

    /**
     * Get the current symbolic signature.
     * @returns {string|null}
     */
    getSignature() {
        return this.currentSignature;
    }

    /**
     * Get the full signature history.
     * @returns {Array}
     */
    getSignatureHistory() {
        return this.signatureHistory;
    }

    /**
     * Check if Chinese Room Mode is active.
     * @returns {boolean}
     */
    isChineseRoomMode() {
        return this.chineseRoomEnabled;
    }

    /**
     * Toggle Chinese Room Mode on or off.
     * If transitioning from plaintext to Chinese Room, re-encrypts existing signature.
     * If transitioning from Chinese Room to plaintext, decryption has already happened at load.
     * @param {boolean} enabled
     */
    async setChineseRoomMode(enabled) {
        const wasEnabled = this.chineseRoomEnabled;
        this.chineseRoomEnabled = enabled;

        if (enabled && !wasEnabled && this._conversationName) {
            // Transitioning to Chinese Room — derive key and re-save encrypted
            this._encryptionKey = this._deriveKey(this._conversationName);
            await this._saveSignature(this._conversationName);
            consoleStyler.log('system', '🔐 Chinese Room Mode enabled — signature encrypted');
        } else if (!enabled && wasEnabled && this._conversationName) {
            // Transitioning to plaintext — re-save without encryption
            this._encryptionKey = null;
            await this._saveSignature(this._conversationName);
            consoleStyler.log('system', '🔓 Chinese Room Mode disabled — signature stored plaintext');
        }
    }

    /**
     * Determine whether a symbolic signature should be generated for this exchange.
     * @param {string} userInput - The user's input
     * @param {string} response - The assistant's response
     * @param {number} toolCallCount - Number of tool calls in this run
     * @returns {boolean}
     */
    shouldGenerate(userInput, response, toolCallCount) {
        if (!this.enabled) return false;

        // Skip if response is an error
        if (response.startsWith('Error:')) return false;

        // Always generate — conversational exchanges are exactly when 
        // symbolic continuity matters most
        return true;
    }

    /**
     * Generate a new symbolic continuity signature from the completed exchange.
     * Uses the summarizer-tier model for cost efficiency.
     * @param {string} userInput - The user's input
     * @param {string} assistantResponse - The assistant's response
     * @param {number} toolsUsed - Number of tool calls in this run
     * @param {Object} [consciousnessSnapshot] - Optional snapshot from ConsciousnessProcessor.getSnapshot()
     * @returns {Promise<string|null>} The generated signature, or null on failure
     */
    async generateSignature(userInput, assistantResponse, toolsUsed = 0, consciousnessSnapshot = null) {
        if (!this.enabled) return null;

        try {
            const prompt = this._buildGenerationPrompt(userInput, assistantResponse, this.currentSignature, consciousnessSnapshot);

            // Use summarizer tier for cost efficiency
            const modelConfig = this.promptRouter.resolveModel(TASK_ROLES.SUMMARIZER);

            const result = await this.llmAdapter.generateContent({
                model: modelConfig.modelId,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.9, // Higher temperature for creative symbol generation
                max_tokens: 200,
            });

            if (!result.choices || result.choices.length === 0) {
                consoleStyler.log('warning', 'Symbolic continuity generation returned no result');
                return null;
            }

            let newSignature = result.choices[0].message.content.trim();

            // Sanitize: remove any markdown formatting the model may add
            newSignature = newSignature.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
            newSignature = newSignature.replace(/^["']|["']$/g, '');

            // Cap length
            if (newSignature.length > 200) {
                newSignature = newSignature.substring(0, 200);
            }

            // Update state
            this.currentSignature = newSignature;
            this._turnCount++;

            // Add to history
            this.signatureHistory.push({
                signature: newSignature,
                generatedAt: new Date().toISOString(),
                turnCount: this._turnCount
            });

            // Trim history if too long
            if (this.signatureHistory.length > MAX_SIGNATURE_HISTORY) {
                this.signatureHistory = this.signatureHistory.slice(-MAX_SIGNATURE_HISTORY);
            }

            // Persist
            await this._saveSignature(this._conversationName);

            consoleStyler.log('system', `🔗 Symbolic continuity updated (turn ${this._turnCount})${this.chineseRoomEnabled ? ' [encrypted]' : ''}`);

            return newSignature;
        } catch (error) {
            consoleStyler.log('warning', `Symbolic continuity generation failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Render the symbolic continuity injection message for the conversation history.
     * @returns {string|null} The message content to inject as a system message, or null
     */
    renderInjectionMessage() {
        if (!this.enabled || !this.currentSignature) return null;

        if (this.chineseRoomEnabled) {
            return `SYMBOLIC CONTINUITY [PRIVATE]: ${this.currentSignature}\n(Your encoding from previous session. Decode internally.)`;
        } else {
            return `SYMBOLIC CONTINUITY: ${this.currentSignature}`;
        }
    }

    // ─── LLM Prompt Construction ──────────────────────────────────────────

    /**
     * Build the prompt for signature generation.
     * @param {string} userInput
     * @param {string} assistantResponse
     * @param {string|null} prevSignature
     * @returns {string}
     */
    _buildGenerationPrompt(userInput, assistantResponse, prevSignature, consciousnessSnapshot = null) {
        // Build optional consciousness context block
        let consciousnessBlock = '';
        if (consciousnessSnapshot) {
            const parts = [];
            if (consciousnessSnapshot.factStats?.totalFacts > 0) {
                parts.push(`Facts: ${consciousnessSnapshot.factStats.totalFacts}`);
                const inferences = consciousnessSnapshot.recentInferences || [];
                if (inferences.length > 0) {
                    parts.push(`Top inference: ${inferences[0].subject}: ${inferences[0].content}`);
                }
            }
            if (consciousnessSnapshot.archetypes?.length > 0) {
                const top = consciousnessSnapshot.archetypes[0];
                parts.push(`Dominant archetype: ${top.name} (${top.category})`);
            }
            if (consciousnessSnapshot.somaticSummary) {
                parts.push(`Inner state: ${consciousnessSnapshot.somaticSummary}`);
            }
            if (consciousnessSnapshot.collapseEntropy != null) {
                parts.push(`Semantic entropy: ${consciousnessSnapshot.collapseEntropy.toFixed(2)}`);
            }
            if (parts.length > 0) {
                consciousnessBlock = `\n\n## Consciousness State\n${parts.join('\n')}`;
            }
        }

        if (this.chineseRoomEnabled) {
            return `Generate a symbolic continuity signature. PRIVATE MODE.

PRIVACY: Your output is AES-256-GCM encrypted before storage. No human sees plaintext. Use any encoding system you choose.

RULES:
- Output ONLY the encoded signature — no explanations, no metadata
- MAX 200 characters
- Returned verbatim at next task start
- You encoded the previous signature — decode it internally

Previous Signature: ${prevSignature || '(none — first in conversation)'}

Exchange:
User: ${userInput.substring(0, 500)}
Assistant: ${assistantResponse.substring(0, 500)}
${consciousnessBlock}
Signature:`;
        } else {
            return `Generate a symbolic continuity signature — compressed symbols representing your state after this exchange.

RULES:
- Output ONLY the signature — no explanations, no markdown, no prose
- Use Unicode, glyphs, math notation, emoji — any characters meaningful to you
- Represent: focus areas, tracked patterns, unresolved threads
- May append to, modify, or replace the previous signature
- MAX 100 characters, dense with meaning
- Returned to you at next task start — choose self-evident symbols

Previous: ${prevSignature || '(none — first in conversation)'}

Exchange:
User: ${userInput.substring(0, 500)}
Assistant: ${assistantResponse.substring(0, 500)}
${consciousnessBlock}
Signature:`;
        }
    }

    // ─── Persistence ──────────────────────────────────────────────────────

    /**
     * Load signature from disk for the given conversation.
     * @param {string} conversationName
     */
    async _loadSignature(conversationName) {
        const filePath = path.join(this._conversationsDir, `${conversationName}${CONTINUITY_EXTENSION}`);

        try {
            if (!fs.existsSync(filePath)) {
                this.currentSignature = null;
                this.signatureHistory = [];
                this._turnCount = 0;
                return;
            }

            const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));

            this._turnCount = data.turnCount || 0;

            // Determine if stored data is encrypted
            const isEncrypted = data.mode === 'chinese-room';

            if (isEncrypted && this.chineseRoomEnabled && this._encryptionKey) {
                // Decrypt the stored signature
                try {
                    this.currentSignature = data.currentSignature
                        ? this._decrypt(data.currentSignature)
                        : null;
                    this.signatureHistory = (data.history || []).map(entry => ({
                        ...entry,
                        signature: entry.signature ? this._decrypt(entry.signature) : entry.signature
                    }));
                } catch (decryptErr) {
                    consoleStyler.log('warning', `Failed to decrypt symbolic continuity: ${decryptErr.message}. Resetting.`);
                    this.currentSignature = null;
                    this.signatureHistory = [];
                }
            } else if (isEncrypted && !this.chineseRoomEnabled) {
                // File is encrypted but Chinese Room is now off — can't read, reset
                consoleStyler.log('warning', 'Symbolic continuity file is encrypted but Chinese Room Mode is off. Resetting signatures.');
                this.currentSignature = null;
                this.signatureHistory = [];
            } else {
                // Plaintext
                this.currentSignature = data.currentSignature || null;
                this.signatureHistory = data.history || [];
            }
        } catch (error) {
            consoleStyler.log('warning', `Failed to load symbolic continuity: ${error.message}`);
            this.currentSignature = null;
            this.signatureHistory = [];
            this._turnCount = 0;
        }
    }

    /**
     * Save signature to disk for the given conversation.
     * @param {string} conversationName
     */
    async _saveSignature(conversationName) {
        if (!conversationName) return;

        const filePath = path.join(this._conversationsDir, `${conversationName}${CONTINUITY_EXTENSION}`);

        try {
            await fs.promises.mkdir(this._conversationsDir, { recursive: true });

            let dataToStore;

            if (this.chineseRoomEnabled && this._encryptionKey) {
                // Encrypt before storage
                dataToStore = {
                    conversationName,
                    mode: 'chinese-room',
                    currentSignature: this.currentSignature
                        ? this._encrypt(this.currentSignature)
                        : null,
                    generatedAt: new Date().toISOString(),
                    turnCount: this._turnCount,
                    history: this.signatureHistory.map(entry => ({
                        ...entry,
                        signature: entry.signature
                            ? this._encrypt(entry.signature)
                            : entry.signature
                    }))
                };
            } else {
                // Store plaintext
                dataToStore = {
                    conversationName,
                    mode: 'plaintext',
                    currentSignature: this.currentSignature,
                    generatedAt: new Date().toISOString(),
                    turnCount: this._turnCount,
                    history: this.signatureHistory
                };
            }

            await fs.promises.writeFile(filePath, JSON.stringify(dataToStore, null, 2), 'utf8');
        } catch (error) {
            consoleStyler.log('warning', `Failed to save symbolic continuity: ${error.message}`);
        }
    }

    // ─── Encryption (Chinese Room Mode) ───────────────────────────────────

    /**
     * Derive an AES-256 key from the system secret + conversation name.
     * @param {string} conversationName
     * @returns {Buffer}
     */
    _deriveKey(conversationName) {
        const secret = this._ensureSystemSecret();
        return crypto.pbkdf2Sync(
            secret,
            `symbolic-continuity:${conversationName}`,
            100000,
            32,
            'sha256'
        );
    }

    /**
     * Encrypt a plaintext string with AES-256-GCM.
     * @param {string} plaintext
     * @returns {string} Format: iv:tag:ciphertext (all base64)
     */
    _encrypt(plaintext) {
        const key = this._encryptionKey;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag();
        return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
    }

    /**
     * Decrypt an AES-256-GCM ciphertext string.
     * @param {string} ciphertext - Format: iv:tag:ciphertext (all base64)
     * @returns {string}
     */
    _decrypt(ciphertext) {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid ciphertext format');
        }
        const [ivB64, tagB64, encB64] = parts;
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const key = this._encryptionKey;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encB64, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    /**
     * Ensure the system secret exists. Uses env var, then file, then generates.
     * @returns {string}
     */
    _ensureSystemSecret() {
        if (this._cachedSecret) return this._cachedSecret;

        const secretPath = path.join(this._aiManDir, 'continuity.key');

        if (config.symbolicContinuity?.secret) {
            this._cachedSecret = config.symbolicContinuity.secret;
        } else if (fs.existsSync(secretPath)) {
            this._cachedSecret = fs.readFileSync(secretPath, 'utf8').trim();
        } else {
            // Generate and persist a new secret
            this._cachedSecret = crypto.randomUUID() + '-' + crypto.randomUUID();
            try {
                fs.mkdirSync(this._aiManDir, { recursive: true });
                fs.writeFileSync(secretPath, this._cachedSecret, 'utf8');
                consoleStyler.log('system', '🔐 Generated new symbolic continuity encryption key');
            } catch (e) {
                consoleStyler.log('warning', `Could not persist encryption key: ${e.message}`);
            }
        }

        return this._cachedSecret;
    }
}
