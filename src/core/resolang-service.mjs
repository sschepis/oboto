import fs from 'fs';
import path from 'path';
import os from 'os';
import * as Resolang from '@sschepis/resolang';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Service to manage the ResoLang Sentient Core and Holographic Memory.
 * 
 * Note: Uses the available low-level WASM bindings from @sschepis/resolang
 * to construct a custom agent loop, as the high-level AgentPipeline 
 * bindings are currently unavailable in the installed version.
 */
export class ResoLangService {
    constructor(workingDir) {
        this.workingDir = workingDir;
        this.memoryFile = path.join(workingDir, '.memory.json');
        this.memoryMap = new Map(); // Maps id -> memory entry
        this.globalMemoryMap = new Map(); // Global memory map
        this.globalMemoryFile = null; // Set during initialize
        this.isInitialized = false;
        
        // WASM Pointers
        this.hologram = null;
        this.coreStarted = false;
        
        // Configuration
        this.numOscillators = 16;
        this.primes = [];
    }

    /**
     * Initialize the sentient core and replay memory.
     */
    async initialize() {
        if (this.isInitialized) return;

        consoleStyler.log('system', 'Initializing ResoLang Sentient Core...');

        try {
            // 1. Initialize Global Sentient Core
            // Using BigInt for timestamp as per d.ts definition
            Resolang.startSentientCore(BigInt(Date.now()));
            this.coreStarted = true;

            // 2. Create Holographic Encoding Grid
            this.hologram = Resolang.createHolographicEncoding();

            // 3. Generate Primes for Oscillator Mapping
            // generatePrimes returns Array<number>
            this.primes = Resolang.generatePrimes(this.numOscillators);

            // 4. Load existing memory
            await this.loadAndReplayMemory();

            // 5. Initialize and Load Global Memory
            const homeDir = os.homedir();
            const globalDir = path.join(homeDir, '.oboto');
            
            if (!fs.existsSync(globalDir)) {
                await fs.promises.mkdir(globalDir, { recursive: true });
            }
            
            this.globalMemoryFile = path.join(globalDir, 'global-memory.json');
            await this.loadGlobalMemory();

            this.isInitialized = true;
            consoleStyler.log('system', '✓ ResoLang Core online and holographic field established.');
        } catch (error) {
            consoleStyler.log('error', `Failed to initialize ResoLang: ${error.message}`);
        }
    }

    /**
     * Load global memory from user's home directory.
     */
    async loadGlobalMemory() {
        if (!this.globalMemoryFile || !fs.existsSync(this.globalMemoryFile)) {
            return;
        }

        try {
            const data = await fs.promises.readFile(this.globalMemoryFile, 'utf8');
            let entries = [];
            try {
                entries = JSON.parse(data);
            } catch (e) {
                consoleStyler.log('warning', 'Global memory file corrupted, starting fresh.');
                return;
            }

            consoleStyler.log('system', `Loaded ${entries.length} global memory traces.`);

            // We don't replay global memory into the local hologram to avoid pollution,
            // but we keep it in memory for querying.
            for (const entry of entries) {
                this.globalMemoryMap.set(entry.id, entry);
            }
        } catch (error) {
            consoleStyler.log('error', `Error loading global memory file: ${error.message}`);
        }
    }

    /**
     * Save global memory to disk.
     */
    async saveGlobalMemory() {
        if (!this.globalMemoryFile) return;

        try {
            const entries = Array.from(this.globalMemoryMap.values());
            const data = JSON.stringify(entries, null, 2);
            // Use atomic write if possible, or simple write
            await fs.promises.writeFile(this.globalMemoryFile, data, 'utf8');
        } catch (error) {
            consoleStyler.log('error', `Failed to save global memory: ${error.message}`);
        }
    }

    /**
     * Promote a memory to the global store.
     */
    async promoteToGlobal(text, metadata = {}) {
        const id = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
        const entry = {
            id,
            text,
            metadata,
            timestamp: Date.now(),
            sourceProject: this.workingDir
        };
        
        this.globalMemoryMap.set(id, entry);
        await this.saveGlobalMemory();
        consoleStyler.log('memory', `Promoted memory to global store: "${text.substring(0, 50)}..."`);
        return entry;
    }

    /**
     * Query the global memory store.
     */
    async queryGlobal(query, maxResults = 5) {
        if (!query) return [];
        
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
        const results = [];
        
        for (const entry of this.globalMemoryMap.values()) {
            let score = 0;
            const textLower = entry.text.toLowerCase();
            
            for (const term of queryTerms) {
                if (textLower.includes(term)) score += 1;
            }
            
            if (score > 0) {
                results.push({
                    text: entry.text,
                    score,
                    metadata: entry.metadata,
                    timestamp: entry.timestamp,
                    sourceProject: entry.sourceProject
                });
            }
        }
        
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, maxResults);
    }

    /**
     * Load memory from disk and replay to restore holographic field.
     */
    async loadAndReplayMemory() {
        if (!fs.existsSync(this.memoryFile)) {
            return;
        }

        try {
            const data = await fs.promises.readFile(this.memoryFile, 'utf8');
            let entries = [];
            try {
                entries = JSON.parse(data);
            } catch (e) {
                consoleStyler.log('warning', 'Memory file corrupted, starting fresh.');
                return;
            }

            consoleStyler.log('system', `Replaying ${entries.length} memory traces to hologram...`);

            for (const entry of entries) {
                // Re-encode into holographic field
                const coords = this.getCoordinates(entry.text);
                if (this.hologram) {
                    Resolang.holographicEncodingEncode(
                        this.hologram, 
                        coords.x, 
                        coords.y, 
                        entry.entropy || 0.5
                    );
                }
                
                this.memoryMap.set(entry.id, entry);
            }
        } catch (error) {
            consoleStyler.log('error', `Error loading memory file: ${error.message}`);
        }
    }

    /**
     * Process a message (User or Assistant).
     * Updates the Sentient Core physics and encodes the memory.
     */
    async processMessage(role, text) {
        if (!text) return;

        try {
            const timestamp = BigInt(Date.now());

            // 1. Tick the core (evolve state)
            if (this.coreStarted) {
                Resolang.tickSentientCore(0.1, timestamp);
            }

            // 2. Excite oscillator based on prime resonance
            // We map the text to a specific prime oscillator using a more
            // sophisticated hash that maps to our generated prime set
            if (this.coreStarted && this.primes.length > 0) {
                const targetOscillator = this.mapTextToOscillator(text);
                if (targetOscillator >= 0 && targetOscillator < this.numOscillators) {
                    Resolang.exciteSentientOscillator(targetOscillator, 0.8);
                }
            }

            // 3. Get current Cognitive State
            const coherence = this.coreStarted ? Resolang.getSentientCoherence() : 0.5;
            const entropy = this.coreStarted ? Resolang.getSentientEntropy() : 0.5;

            // 4. Encode into Hologram
            const coords = this.getCoordinates(text);
            let encodedAmplitude = 0;
            if (this.hologram) {
                encodedAmplitude = Resolang.holographicEncodingEncode(
                    this.hologram,
                    coords.x,
                    coords.y,
                    entropy
                );
            }

            // 5. Persist
            const entry = {
                id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
                text,
                role,
                timestamp: Date.now(),
                coherence,
                entropy,
                coordinates: coords,
                encodedAmplitude
            };

            this.memoryMap.set(entry.id, entry);
            await this.saveMemory();

            return entry;
        } catch (error) {
            consoleStyler.log('error', `Failed to process message in ResoLang: ${error.message}`);
        }
    }

    /**
     * Recall relevant context.
     * Uses a simple keyword/ranking approach since we rely on shadow persistence.
     */
    async recall(query, maxResults = 5) {
        if (!query) return [];

        try {
            const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
            const results = [];

            for (const entry of this.memoryMap.values()) {
                // Relevance scoring
                let score = 0;
                const textLower = entry.text.toLowerCase();
                
                // Term match
                for (const term of queryTerms) {
                    if (textLower.includes(term)) score += 1;
                }

                // Boost by coherence (higher coherence memories are more recallable)
                if (entry.coherence) {
                    score *= (1 + entry.coherence);
                }
                
                // Time decay (optional, but good for "short term" vs "long term")
                // const age = Date.now() - entry.timestamp;
                // score *= (1 / (1 + age / 86400000)); // Decay over days

                if (score > 0) {
                    results.push({
                        text: entry.text,
                        role: entry.role,
                        score,
                        metadata: {
                            coherence: entry.coherence,
                            entropy: entry.entropy,
                            timestamp: entry.timestamp
                        }
                    });
                }
            }

            // Sort by score descending
            results.sort((a, b) => b.score - a.score);
            return results.slice(0, maxResults);

        } catch (error) {
            consoleStyler.log('error', `Failed to recall memory: ${error.message}`);
            return [];
        }
    }

    /**
     * Get the current cognitive state of the agent.
     */
    getAgentState() {
        if (!this.coreStarted) return null;
        return {
            coherence: Resolang.getSentientCoherence(),
            entropy: Resolang.getSentientEntropy(),
            stateString: Resolang.getSentientState()
        };
    }

    /**
     * Save memory to disk atomically.
     */
    async saveMemory() {
        try {
            const entries = Array.from(this.memoryMap.values());
            const data = JSON.stringify(entries, null, 2);
            const tempFile = `${this.memoryFile}.tmp`;
            
            await fs.promises.writeFile(tempFile, data, 'utf8');
            await fs.promises.rename(tempFile, this.memoryFile);
        } catch (error) {
            consoleStyler.log('error', `Failed to save memory: ${error.message}`);
        }
    }

    // --- Helpers ---

    // Generate deterministic coordinates from text for holographic storage
    getCoordinates(text) {
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
            let ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = ((h1 ^ h1 >>> 16) >>> 0);
        h2 = ((h2 ^ h2 >>> 16) >>> 0);
        
        // Map to -1.0 to 1.0
        const x = (h1 / 4294967296) * 2 - 1;
        const y = (h2 / 4294967296) * 2 - 1;
        return { x, y };
    }

    hashText(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (hash << 5) - hash + text.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }
    
    mapTextToOscillator(text) {
        // Simple mapping: hash modulo number of oscillators
        // We could make this more complex by using prime factoring of char codes
        const hash = this.hashText(text);
        return hash % this.numOscillators;
    }

    // MemoryAdapter Interface

    async store(text, metadata = {}) {
        return this.processMessage(metadata.role || 'user', text);
    }

    async retrieve(query, topK = 5) {
        return this.recall(query, topK);
    }
}
