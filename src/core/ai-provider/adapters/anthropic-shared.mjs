// ─── Shared Anthropic Adapter Utilities ──────────────────────────────────
// Common functions used by both the Vertex SDK adapter (anthropic.mjs)
// and the direct REST adapter (anthropic-direct.mjs).

import { getModelInfo } from '../../model-registry.mjs';

const DEFAULT_MAX_TOKENS = 16384;

// ─── Schema Sanitisation ─────────────────────────────────────────────────
// Anthropic requires tool input_schema to conform to JSON Schema draft
// 2020-12.  OpenAI is more permissive, so tool definitions authored for
// the OpenAI function-calling format may contain keywords that Anthropic
// rejects (e.g. `default`, `examples`).  This helper recursively strips
// unsupported keywords and fixes structural issues.

/** Keywords that Anthropic rejects inside tool input_schema. */
export const BLOCKED_KEYWORDS = new Set([
    'default',
    'examples',
    '$comment',
    '$id',
    '$anchor',
    '$schema',
    'title',
    // OpenAI-specific extensions
    'strict',
]);

/**
 * Recursively sanitise a JSON Schema object so it conforms to Anthropic's
 * JSON Schema draft 2020-12 requirements for tool `input_schema`.
 *
 * Mutations are performed in-place on a **deep clone** — the original
 * schema object is never modified.
 *
 * @param {any} schema - A JSON Schema (or sub-schema) value
 * @returns {any} The sanitised schema (a new object)
 */
export function sanitizeInputSchema(schema) {
    if (schema == null || typeof schema !== 'object') return schema;

    // Deep-clone so we never mutate caller's data
    const clone = Array.isArray(schema) ? [...schema] : { ...schema };

    if (Array.isArray(clone)) {
        return clone.map(item => sanitizeInputSchema(item));
    }

    // Remove blocked keywords at this level
    for (const key of BLOCKED_KEYWORDS) {
        delete clone[key];
    }

    // "type": "any" is not valid JSON Schema — remove it to mean "accept any type"
    if (clone.type === 'any') {
        delete clone.type;
    }

    // Ensure root-level objects have type: 'object' when they contain properties
    if (clone.properties && !clone.type) {
        clone.type = 'object';
    }

    // Anthropic requires additionalProperties to be absent or false.
    // Boolean true and object sub-schemas are both rejected by certain
    // API versions, so coerce any non-false value to false.
    if (clone.additionalProperties != null && clone.additionalProperties !== false) {
        clone.additionalProperties = false;
    }

    // Recurse into sub-schemas
    if (clone.properties && typeof clone.properties === 'object') {
        const cleaned = {};
        for (const [propName, propSchema] of Object.entries(clone.properties)) {
            cleaned[propName] = sanitizeInputSchema(propSchema);
        }
        clone.properties = cleaned;

        // Ensure 'required' only references properties that actually exist
        if (Array.isArray(clone.required)) {
            const propNames = new Set(Object.keys(cleaned));
            clone.required = clone.required.filter(r => propNames.has(r));
            if (clone.required.length === 0) delete clone.required;
        }
    }

    if (clone.items) {
        clone.items = sanitizeInputSchema(clone.items);
    }

    // Composite keywords
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(clone[keyword])) {
            clone[keyword] = clone[keyword].map(s => sanitizeInputSchema(s));
        }
    }

    if (clone.not) {
        clone.not = sanitizeInputSchema(clone.not);
    }

    return clone;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize message content to an array of content blocks.
 * Used when merging consecutive same-role messages.
 *
 * @param {string|Array|undefined} content
 * @returns {Array<{type: string, [key: string]: any}>}
 */
function _toContentArray(content) {
    if (Array.isArray(content)) return content;
    if (typeof content === 'string' && content) return [{ type: 'text', text: content }];
    return [];
}

// ─── OpenAI → Anthropic Format Translation ──────────────────────────────

/**
 * Convert OpenAI-format messages to Anthropic Messages API format.
 * Extracts system messages into a separate `system` parameter and
 * maps remaining messages to Anthropic's `messages` array.
 *
 * @param {Array} openaiMessages - OpenAI-format messages array
 * @returns {{ system: string|undefined, messages: Array }}
 */
export function translateMessages(openaiMessages) {
    const systemParts = [];
    const messages = [];

    for (const msg of openaiMessages) {
        if (msg.role === 'system') {
            if (msg.content) {
                systemParts.push(msg.content);
            }
            continue;
        }

        if (msg.role === 'user') {
            messages.push({
                role: 'user',
                content: msg.content,
            });
            continue;
        }

        if (msg.role === 'assistant') {
            // Build content blocks array for assistant messages
            const contentBlocks = [];

            // Text content
            if (msg.content) {
                contentBlocks.push({ type: 'text', text: msg.content });
            }

            // Tool calls → Anthropic tool_use content blocks
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    let parsedInput = {};
                    if (typeof tc.function?.arguments === 'string') {
                        try { parsedInput = JSON.parse(tc.function.arguments); }
                        catch { parsedInput = { _raw: tc.function.arguments }; }
                    } else if (tc.function?.arguments) {
                        parsedInput = tc.function.arguments;
                    }
                    contentBlocks.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function?.name || 'unknown',
                        input: parsedInput,
                    });
                }
            }

            messages.push({
                role: 'assistant',
                content: contentBlocks.length > 0 ? contentBlocks : [{ type: 'text', text: '' }],
            });
            continue;
        }

        // Tool results → Anthropic 'user' role with tool_result content blocks
        if (msg.role === 'tool') {
            const resultContent = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content ?? '');
            messages.push({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: msg.tool_call_id || msg.name || 'unknown',
                    content: resultContent,
                }],
            });
            continue;
        }
    }

    // Anthropic requires alternating user/assistant turns.
    // Merge consecutive same-role messages, handling both string and array content.
    const merged = [];
    for (const entry of messages) {
        if (merged.length > 0 && merged[merged.length - 1].role === entry.role) {
            const prev = merged[merged.length - 1];
            // Merge content: normalize both to arrays, then concatenate
            const prevBlocks = _toContentArray(prev.content);
            const entryBlocks = _toContentArray(entry.content);
            prev.content = [...prevBlocks, ...entryBlocks];
        } else {
            merged.push({ ...entry });
        }
    }

    // Anthropic requires conversation to start with 'user'.
    // If it starts with 'assistant', prepend a synthetic user turn.
    if (merged.length > 0 && merged[0].role === 'assistant') {
        merged.unshift({ role: 'user', content: '(continue)' });
    }

    const system = systemParts.length > 0
        ? systemParts.join('\n\n---\n\n')
        : undefined;

    return { system, messages: merged };
}

/**
 * Build the Anthropic SDK params from an OpenAI-compatible request body.
 *
 * @param {Object} requestBody - OpenAI-format request body
 * @param {string} model - The model to use
 * @returns {Object} Anthropic Messages API params for SDK
 */
export function buildAnthropicBody(requestBody, model) {
    const { system, messages } = translateMessages(requestBody.messages || []);

    // Clamp max_tokens to the model's known output token limit to avoid
    // Anthropic API errors like "max_tokens: 200000 > 128000".
    let maxTokens = requestBody.max_tokens || DEFAULT_MAX_TOKENS;
    try {
        const modelInfo = getModelInfo(model);
        if (modelInfo && modelInfo.maxOutputTokens > 0) {
            maxTokens = Math.min(maxTokens, modelInfo.maxOutputTokens);
        }
    } catch {
        // Model registry not available — proceed with unclamped value
    }

    const params = {
        model,
        messages,
        max_tokens: maxTokens,
    };

    if (system) {
        params.system = system;
    }

    if (requestBody.temperature != null) {
        params.temperature = requestBody.temperature;
    }

    if (requestBody.top_p != null) {
        params.top_p = requestBody.top_p;
    }

    if (requestBody.stop) {
        params.stop_sequences = Array.isArray(requestBody.stop)
            ? requestBody.stop
            : [requestBody.stop];
    }

    // Translate OpenAI tools format to Anthropic tools format.
    // Each input_schema is sanitised to conform to JSON Schema draft 2020-12.
    if (requestBody.tools && requestBody.tools.length > 0) {
        params.tools = requestBody.tools.map(tool => {
            const rawSchema = tool.function?.parameters || tool.parameters || { type: 'object', properties: {} };
            const name = tool.function?.name || tool.name;
            const sanitized = sanitizeInputSchema(rawSchema);
            // Anthropic requires top-level input_schema to have type: 'object'
            if (!sanitized.type) {
                sanitized.type = 'object';
            }
            return {
                name,
                description: tool.function?.description || tool.description || '',
                input_schema: sanitized,
            };
        });
    }

    // If response_format requests JSON output, append a JSON instruction to the
    // system prompt. Anthropic doesn't have native JSON mode — the convention is
    // system prompt instruction.
    // Note: lmscript's executeAgent() already injects schema instructions, so
    // this is a belt-and-suspenders approach for non-lmscript callers.
    if (requestBody.response_format) {
        const rfType = requestBody.response_format.type;
        if (rfType === 'json_object' || rfType === 'json_schema') {
            const jsonInstruction = '\n\nIMPORTANT: You MUST respond ONLY with valid JSON. Do not include any text, markdown formatting, or code fences outside the JSON object.';
            if (params.system) {
                params.system += jsonInstruction;
            } else {
                params.system = jsonInstruction.trim();
            }
        }
    }

    return params;
}

/**
 * Map Anthropic stop_reason to OpenAI finish_reason.
 * @param {string} stopReason - Anthropic stop reason
 * @returns {string} OpenAI-compatible finish reason
 */
export function mapFinishReason(stopReason) {
    switch (stopReason) {
        case 'end_turn': return 'stop';
        case 'max_tokens': return 'length';
        case 'stop_sequence': return 'stop';
        case 'tool_use': return 'tool_calls';
        default: return stopReason || 'stop';
    }
}

/**
 * Translate an Anthropic Messages API response to OpenAI-compatible format.
 *
 * @param {Object} anthropicResponse - Anthropic API response
 * @returns {Object} OpenAI-compatible response
 */
export function anthropicResponseToOpenai(anthropicResponse) {
    const contentBlocks = anthropicResponse.content || [];

    // Extract text from content blocks
    const textParts = contentBlocks
        .filter(block => block.type === 'text')
        .map(block => block.text);

    const content = textParts.join('') || null;
    const finishReason = mapFinishReason(anthropicResponse.stop_reason);

    // Build the assistant message
    const message = {
        role: 'assistant',
        content,
    };

    // Extract tool_use blocks → OpenAI tool_calls format
    const toolUseBlocks = contentBlocks.filter(block => block.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
        message.tool_calls = toolUseBlocks.map(block => ({
            id: block.id,
            type: 'function',
            function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {}),
            },
        }));
    }

    return {
        choices: [{
            index: 0,
            message,
            finish_reason: finishReason,
        }],
        usage: anthropicResponse.usage ? {
            prompt_tokens: anthropicResponse.usage.input_tokens || 0,
            completion_tokens: anthropicResponse.usage.output_tokens || 0,
            total_tokens: (anthropicResponse.usage.input_tokens || 0) +
                          (anthropicResponse.usage.output_tokens || 0),
        } : undefined,
    };
}
