// Prompt Router
// Maps task roles to specific models and manages token budgets.
// This is the core routing engine that determines which model handles each type of LLM call.

import { getModelInfo, inferModelProvider } from './model-registry.mjs';
import { config } from '../config.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Task roles that can be routed to different models.
 * @readonly
 */
export const TASK_ROLES = {
    /** Main tool-calling agentic loop */
    AGENTIC: 'agentic',
    /** Complex coding, architecture, debugging */
    REASONING_HIGH: 'reasoning_high',
    /** Standard coding, moderate reasoning */
    REASONING_MEDIUM: 'reasoning_medium',
    /** Simple queries, formatting, Q&A */
    REASONING_LOW: 'reasoning_low',
    /** History summarization, context compression */
    SUMMARIZER: 'summarizer',
    /** Ghost text / inline code completion */
    CODE_COMPLETION: 'code_completion',
    /** Fast feasibility check / triage */
    TRIAGE: 'triage',
};

/**
 * Role metadata — requirements and descriptions.
 */
const ROLE_METADATA = {
    [TASK_ROLES.AGENTIC]: {
        label: 'Agentic (Tool Calling)',
        description: 'Main agentic loop with tool/function calling',
        requiresToolCalling: true,
    },
    [TASK_ROLES.REASONING_HIGH]: {
        label: 'High Reasoning',
        description: 'Complex coding, architecture, debugging, analysis',
        requiresToolCalling: false,
    },
    [TASK_ROLES.REASONING_MEDIUM]: {
        label: 'Medium Reasoning',
        description: 'Standard coding, moderate reasoning tasks',
        requiresToolCalling: false,
    },
    [TASK_ROLES.REASONING_LOW]: {
        label: 'Low Reasoning / Quick',
        description: 'Simple queries, formatting, quick answers',
        requiresToolCalling: false,
    },
    [TASK_ROLES.SUMMARIZER]: {
        label: 'Summarizer',
        description: 'History summarization, context compression',
        requiresToolCalling: false,
    },
    [TASK_ROLES.CODE_COMPLETION]: {
        label: 'Code Completion',
        description: 'Inline ghost text / code completion',
        requiresToolCalling: false,
    },
    [TASK_ROLES.TRIAGE]: {
        label: 'Triage / Feasibility',
        description: 'Fast check for request feasibility and completeness',
        requiresToolCalling: false,
    },
};

export class PromptRouter {
    /**
     * @param {Object} [routingOverrides] - Optional route overrides { [role]: modelId }
     */
    constructor(routingOverrides = {}) {
        // Build routes from EXPLICIT config overrides only.
        // Routes left empty ('') will dynamically fall through to config.ai.model
        // at resolve time, so changing the primary model in settings automatically
        // updates all non-overridden routes.
        this._routes = {
            [TASK_ROLES.AGENTIC]: config.routing?.agentic || '',
            [TASK_ROLES.REASONING_HIGH]: config.routing?.reasoning_high || '',
            [TASK_ROLES.REASONING_MEDIUM]: config.routing?.reasoning_medium || '',
            [TASK_ROLES.REASONING_LOW]: config.routing?.reasoning_low || '',
            [TASK_ROLES.SUMMARIZER]: config.routing?.summarizer || '',
            [TASK_ROLES.CODE_COMPLETION]: config.routing?.code_completion || '',
            [TASK_ROLES.TRIAGE]: config.routing?.triage || '',
            ...routingOverrides,
        };
    }

    /**
     * Resolve a task role to a model and its capabilities.
     * @param {string} role - One of TASK_ROLES values
     * @returns {{ modelId: string, provider: string, contextWindow: number, maxOutputTokens: number, supportsToolCalling: boolean, supportsReasoningEffort: boolean }}
     */
    resolveModel(role) {
        const modelId = this._routes[role] || this._routes[TASK_ROLES.AGENTIC] || config.ai.model;
        const info = getModelInfo(modelId);
        return {
            modelId: info.id,
            provider: info.provider,
            contextWindow: info.contextWindow,
            maxOutputTokens: info.maxOutputTokens,
            supportsToolCalling: info.supportsToolCalling,
            supportsReasoningEffort: info.supportsReasoningEffort,
            costTier: info.costTier,
            reasoningCapability: info.reasoningCapability,
        };
    }

    /**
     * Set a single route.
     * @param {string} role
     * @param {string} modelId
     */
    setRoute(role, modelId) {
        if (!ROLE_METADATA[role]) {
            throw new Error(`Unknown task role: ${role}`);
        }
        this._routes[role] = modelId;
        consoleStyler.log('routing', `Route updated: ${role} → ${modelId}`);
    }

    /**
     * Set multiple routes at once.
     * Empty string values clear the route (falls through to primary model).
     * @param {Object} routes - { [role]: modelId }
     */
    setRoutes(routes) {
        for (const [role, modelId] of Object.entries(routes)) {
            if (ROLE_METADATA[role] && modelId !== undefined && modelId !== null) {
                this._routes[role] = modelId;
            }
        }
    }

    /**
     * Get all current routes.
     * @returns {Object} { [role]: modelId }
     */
    getRoutes() {
        return { ...this._routes };
    }

    /**
     * Get role metadata (labels, descriptions, requirements).
     * @returns {Object}
     */
    static getRoleMetadata() {
        return { ...ROLE_METADATA };
    }

    /**
     * Validate that a model is suitable for a given role.
     * @param {string} role
     * @param {string} modelId
     * @returns {{ valid: boolean, reason?: string }}
     */
    validateRoute(role, modelId) {
        const meta = ROLE_METADATA[role];
        if (!meta) return { valid: false, reason: `Unknown role: ${role}` };

        const info = getModelInfo(modelId);
        if (meta.requiresToolCalling && !info.supportsToolCalling) {
            return {
                valid: false,
                reason: `Model ${modelId} does not support tool calling, required for ${meta.label}`,
            };
        }
        return { valid: true };
    }
}

// ── Token Budget Manager ──────────────────────────────────────────────

/**
 * Estimate token count using character-based heuristic.
 * ~3.5 characters per token for English text.
 * @param {Array} messages - OpenAI-format messages
 * @returns {number} Estimated token count
 */
export function estimateTokens(messages) {
    let totalChars = 0;
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
        }
        if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                totalChars += (tc.function?.name?.length || 0);
                totalChars += (typeof tc.function?.arguments === 'string' ? tc.function.arguments.length : 0);
            }
        }
    }
    return Math.ceil(totalChars / 3.5);
}

/**
 * Trim messages to fit within a model's context window.
 * Preserves: system prompt (index 0), recent exchanges, pending tool results.
 * Removes: oldest exchanges first, middle history.
 *
 * @param {Array} messages - OpenAI-format messages
 * @param {number} contextWindow - Model's max input tokens
 * @param {number} maxOutputTokens - Tokens reserved for output
 * @param {number} [keepRecentExchanges=3] - Number of recent user/assistant exchanges to always keep
 * @returns {{ messages: Array, trimmed: boolean, estimatedTokens: number }}
 */
export function fitToBudget(messages, contextWindow, maxOutputTokens, keepRecentExchanges = 3) {
    const budget = contextWindow - maxOutputTokens;
    const currentEstimate = estimateTokens(messages);

    if (currentEstimate <= budget) {
        return { messages, trimmed: false, estimatedTokens: currentEstimate };
    }

    consoleStyler.log('routing', `Token budget exceeded: ~${currentEstimate} tokens > ${budget} available (${contextWindow} - ${maxOutputTokens}). Trimming...`);

    // Strategy: keep system prompt + last N exchanges, remove middle
    const systemPrompt = messages[0]?.role === 'system' ? [messages[0]] : [];
    const rest = systemPrompt.length ? messages.slice(1) : messages;

    // Identify the last N exchanges (user + assistant + tool pairs)
    const recentMessages = [];
    let exchangeCount = 0;
    for (let i = rest.length - 1; i >= 0; i--) {
        recentMessages.unshift(rest[i]);
        if (rest[i].role === 'user') {
            exchangeCount++;
            if (exchangeCount >= keepRecentExchanges) break;
        }
    }

    const trimmed = [...systemPrompt, ...recentMessages];
    const trimmedEstimate = estimateTokens(trimmed);

    if (trimmedEstimate > budget) {
        // Even the minimum set is too large — keep only system + last exchange
        const minimal = [...systemPrompt];
        for (let i = rest.length - 1; i >= 0; i--) {
            minimal.push(rest[i]);
            if (rest[i].role === 'user') break;
        }
        // Reverse the appended messages (they were added back-to-front)
        const afterSystem = minimal.slice(systemPrompt.length).reverse();
        const finalMinimal = [...systemPrompt, ...afterSystem];
        const minEstimate = estimateTokens(finalMinimal);
        consoleStyler.log('routing', `Aggressively trimmed to ${finalMinimal.length} messages (~${minEstimate} tokens)`);
        return { messages: finalMinimal, trimmed: true, estimatedTokens: minEstimate };
    }

    consoleStyler.log('routing', `Trimmed to ${trimmed.length} messages (~${trimmedEstimate} tokens)`);
    return { messages: trimmed, trimmed: true, estimatedTokens: trimmedEstimate };
}

/**
 * Check if a set of messages fits within a model's context and suggest alternatives if not.
 * @param {Array} messages
 * @param {string} modelId
 * @returns {{ fits: boolean, estimatedTokens: number, availableTokens: number }}
 */
export function checkContextFit(messages, modelId) {
    const info = getModelInfo(modelId);
    const estimated = estimateTokens(messages);
    const available = info.contextWindow - info.maxOutputTokens;
    return {
        fits: estimated <= available,
        estimatedTokens: estimated,
        availableTokens: available,
    };
}
