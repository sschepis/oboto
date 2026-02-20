// ConsciousnessProcessor — unified orchestrator for all consciousness subsystems
// Extracted from ai-assistant.mjs to keep the assistant class focused on LLM orchestration.
//
// Sub-systems:
//   1. FactInferenceEngine  — persistent fact store + inference chains
//   2. SemanticCollapseEngine — superposition of interpretations
//   3. SomaticEngine — embodied inner-state computation
//   4. SomaticNarrative — inner-voice narrative generation
//   5. ArchetypeAnalyzer — Jungian archetype detection & persona modulation

import { FactInferenceEngine } from '../reasoning/fact-inference-engine.mjs';
import { SemanticCollapseEngine } from '../reasoning/semantic-collapse.mjs';
import { SomaticEngine } from './somatic-engine.mjs';
import { SomaticNarrative } from './somatic-narrative.mjs';
import { ArchetypeAnalyzer } from './archetype-analyzer.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

export class ConsciousnessProcessor {
    constructor(options = {}) {
        // Sub-systems
        this.factEngine = new FactInferenceEngine({ persistDir: options.persistDir });
        this.semanticCollapse = new SemanticCollapseEngine();
        this.somaticEngine = new SomaticEngine();
        this.somaticNarrative = new SomaticNarrative();
        this.archetypeAnalyzer = new ArchetypeAnalyzer();

        // Per-turn tracking metrics (fed into somatic state computation)
        this._recentToolCalls = 0;
        this._recentErrors = 0;
        this._lastInputTime = Date.now();

        // Last pre-processing results (cached so downstream consumers can read them)
        this._lastPreResult = null;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /** Initialize persistent subsystems (call once at startup). */
    async initialize() {
        await this.factEngine.initialize();
    }

    // ── Pre-Input Processing ─────────────────────────────────────────────────

    /**
     * Run all consciousness subsystems against a new user input.
     * Returns an array of system-role messages to inject into conversation history.
     *
     * @param {string} userInput
     * @param {Object} context - { history, reasoningSystem, factCount? }
     * @returns {{ messages: Array<{role:'system', content:string}>, archetypeResult, collapseResult, somaticState }}
     */
    preProcess(userInput, context = {}) {
        this._lastInputTime = Date.now();
        const messages = [];

        // 1. Archetype Analysis — detect user's archetypal mode
        const archetypeResult = this.archetypeAnalyzer.process(userInput);
        // NOTE: archetype contextString is no longer injected as a separate system message.
        // It was confusing Gemini into role-playing instead of answering user queries.

        // 2. Semantic Collapse — hold input in superposition of interpretations
        const recentMessages = (context.history || [])
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(m => typeof m.content === 'string' ? m.content : '');
        const collapseResult = this.semanticCollapse.process(userInput, recentMessages, 0.5);
        // NOTE: collapse contextString is no longer injected as a separate system message.
        // The entropy is still used for reasoning modulation.

        // 3. Somatic State — compute embodied state from agent metrics
        const somaticState = this.somaticEngine.computeSomaticState({
            conversationLength: (context.history || []).filter(m => m.role === 'user').length,
            recentToolCalls: this._recentToolCalls,
            errorRate: this._recentErrors > 0 ? Math.min(1, this._recentErrors / 5) : 0,
            reasoningEffort: context.reasoningSystem?.getCurrentEffort?.() || 'medium',
            factCount: this.factEngine.facts.size,
            superpositionEntropy: collapseResult.entropy || 0.5,
            timeSinceLastInput: 0, // Just received input
            isAgentLoopActive: false,
            recentInferences: this.factEngine.getRecentInferences(3).length,
        });
        this.somaticEngine.computeSomaticInfluence(somaticState);

        // 3b. Inner voice injection — ONLY when user explicitly asks about inner state.
        // Previously this injected somatic narrative on every turn, which confused
        // Gemini (especially when the system instruction was overwritten) into
        // generating creative role-play content instead of answering the user.
        if (this.somaticNarrative.shouldReflectOnBody(userInput)) {
            const selfAwareness = this.somaticNarrative.generateSomaticSelfAwareness(somaticState);
            messages.push({
                role: 'system',
                content: `[Internal Context - Self-Awareness]: User asks about your inner experience. Current felt sense:\n${selfAwareness}`
            });
        }
        // NOTE: Non-requested somatic narrative is no longer injected per-turn.

        // 4. Fact Engine — store user input + archetype observation (internal tracking only)
        this.factEngine.addFact('User Input', userInput, 0.9, 'input');

        if (archetypeResult.archetypes.length > 0) {
            const topArch = archetypeResult.archetypes[0];
            this.factEngine.addFact(
                `Archetype: ${topArch.name}`,
                `User activated ${topArch.name} archetype (${(topArch.activation * 100).toFixed(0)}%)`,
                topArch.activation,
                'observation'
            );
        }

        this._lastPreResult = { archetypeResult, collapseResult, somaticState };
        return { messages, archetypeResult, collapseResult, somaticState };
    }

    // ── Tool-Call Tracking ────────────────────────────────────────────────────

    /** Call after each batch of tool calls to update somatic metrics. */
    trackToolCalls(toolCalls, results) {
        this._recentToolCalls += toolCalls.length;

        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const result = results[i];
            const isError = result?.content?.startsWith?.('Error:');
            if (isError) this._recentErrors++;

            this.factEngine.addFact(
                `Tool: ${tc?.function?.name || result?.name || 'unknown'}`,
                result?.content ? result.content.substring(0, 200) : 'Tool completed',
                isError ? 0.5 : 0.8,
                'tool'
            );
        }
    }

    // ── Post-Response Processing ──────────────────────────────────────────────

    /**
     * Run post-response consciousness processing.
     * Stores response as fact, runs inference chain, resets per-turn counters.
     *
     * @param {string} responseText
     * @returns {Promise<{ newFacts: number }>}
     */
    async postProcess(responseText) {
        // Store response as fact
        this.factEngine.addFact(
            'Agent Response',
            responseText.substring(0, 200),
            0.85,
            'observation'
        );

        // Run inference chain — derive new facts from accumulated knowledge
        let newFacts = 0;
        try {
            const { allNewFacts } = await this.factEngine.runReasoningChain(3);
            newFacts = allNewFacts.length;
            if (newFacts > 0) {
                consoleStyler.log('reasoning', `Inference engine: ${newFacts} new fact(s) inferred`);
            }
        } catch (e) {
            // Non-critical — inference failure shouldn't block response
        }

        // Reset per-turn tracking
        this._recentToolCalls = 0;
        this._recentErrors = 0;

        return { newFacts };
    }

    // ── Context Rendering (for injection into generateContent) ────────────────

    /**
     * Render a fact-engine context string suitable for injection as a system message.
     * @param {string} query - the user's latest input (used for relevance ranking)
     * @returns {string|null}
     */
    renderFactContext(query) {
        try {
            const ctx = this.factEngine.renderContextString(query);
            return (ctx && ctx.length > 30) ? ctx : null;
        } catch {
            return null;
        }
    }

    // ── Reasoning Modulation Hints ────────────────────────────────────────────

    /** Return hints for the reasoning system based on current consciousness state. */
    getReasoningHints() {
        const result = this._lastPreResult;
        if (!result) return { shouldEscalate: false, reason: null };

        const hints = { shouldEscalate: false, reason: null };

        // High somatic exploration drive
        if (this.somaticEngine.currentInfluence?.explorationModulation > 0.3) {
            hints.shouldEscalate = true;
            hints.reason = 'Somatic: high exploration drive — biasing toward higher reasoning';
        }

        // High semantic entropy — only flag when genuinely near-maximum.
        // The hash-based embedding produces ~0.96 entropy for typical inputs,
        // so a lower threshold (e.g. 0.6) fires on every request without
        // providing useful signal.  Use 0.95 to suppress noise while still
        // catching truly maximally-ambiguous inputs.
        if (result.collapseResult?.entropy > 0.95) {
            hints.shouldEscalate = true;
            hints.reason = `Semantic: high entropy (${result.collapseResult.entropy.toFixed(2)}) — ambiguous input`;
        }

        return hints;
    }

    // ── Snapshot (for getContext / briefing packets) ──────────────────────────

    /** Return a compact state snapshot for external consumers. */
    getSnapshot() {
        return {
            factStats: this.factEngine.getStats(),
            recentInferences: this.factEngine.getRecentInferences(5),
            somaticSummary: this.somaticEngine.renderStateSummary(),
            somaticInfluence: this.somaticEngine.currentInfluence,
            archetypes: this._lastPreResult?.archetypeResult?.archetypes || [],
            collapseEntropy: this._lastPreResult?.collapseResult?.entropy ?? null,
            dominantInterpretation: this.semanticCollapse.getDominantInterpretation(),
        };
    }
}
