import { config } from '../../../config.mjs';
import { withRetry, withCancellation } from '../utils.mjs';

// Lazy-loaded SDK instance
let _geminiAI = null;

/**
 * Get or create the Gemini SDK client
 * @returns {Object} GoogleGenAI instance
 */
async function getGeminiClient() {
    if (_geminiAI) return _geminiAI;

    const { GoogleGenAI } = await import('@google/genai');
    _geminiAI = new GoogleGenAI({ apiKey: config.keys.google });
    return _geminiAI;
}

// ─── OpenAI ↔ Gemini Format Translation ──────────────────────────────────

/**
 * Convert OpenAI-format tools to Gemini functionDeclarations
 * OpenAI: [{type: "function", function: {name, description, parameters}}]
 * Gemini: [{functionDeclarations: [{name, description, parameters}]}]
 */
export function openaiToolsToGemini(tools) {
    if (!tools || tools.length === 0) return undefined;

    const declarations = tools
        .filter(t => t.type === 'function' && t.function)
        .map(t => {
            const decl = {
                name: t.function.name,
                description: t.function.description || '',
                parameters: sanitizeSchemaForGemini(t.function.parameters),
            };
            return decl;
        });

    return [{ functionDeclarations: declarations }];
}

/**
 * Sanitize a JSON Schema to be compatible with Gemini's expectations.
 * Gemini does not support some JSON Schema constructs that OpenAI does.
 */
export function sanitizeSchemaForGemini(schema) {
    if (!schema) return undefined;

    const clean = { ...schema };

    // Remove unsupported keywords
    delete clean.default;
    delete clean.minimum;
    delete clean.maximum;
    delete clean.$schema;

    // Gemini expects `required` only as an array of property names at the object level.
    // Remove boolean `required` values on individual properties (OpenAI allows this).
    // Also remove empty required arrays — Gemini may reject these.
    if (typeof clean.required === 'boolean') {
        delete clean.required;
    } else if (Array.isArray(clean.required) && clean.required.length === 0) {
        delete clean.required;
    }

    // Gemini doesn't support "any" type — convert to "string"
    if (clean.type === 'any') {
        clean.type = 'string';
    }

    // Recursively clean nested properties
    if (clean.properties) {
        const cleanProps = {};
        for (const [key, value] of Object.entries(clean.properties)) {
            cleanProps[key] = sanitizeSchemaForGemini(value);
        }
        clean.properties = cleanProps;
    }

    // Clean array items
    if (clean.items) {
        clean.items = sanitizeSchemaForGemini(clean.items);
    }

    return clean;
}

/**
 * Convert OpenAI-format messages to Gemini contents + systemInstruction
 * OpenAI: [{role: "system"|"user"|"assistant"|"tool", content, tool_calls, tool_call_id, name}]
 * Gemini: {systemInstruction, contents: [{role: "user"|"model", parts: [...]}]}
 */
export function openaiMessagesToGemini(messages) {
    // Collect ALL system messages and concatenate them.
    // Previously this used `systemInstruction = msg.content` which meant
    // only the LAST system message survived — consciousness/somatic injections
    // would overwrite the main system prompt, stripping scope constraints
    // and causing role confusion (the model would hallucinate fake user content).
    const systemParts = [];
    const contents = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            // Accumulate all system messages — they'll be joined below
            if (msg.content) {
                systemParts.push(msg.content);
            }
            continue;
        }

        if (msg.role === 'user') {
            contents.push({
                role: 'user',
                parts: [{ text: msg.content }],
            });
            continue;
        }

        if (msg.role === 'assistant') {
            // If we have preserved Gemini parts (from a previous round-trip),
            // use them directly to preserve thought/thoughtSignature fields
            if (msg._geminiParts && Array.isArray(msg._geminiParts)) {
                contents.push({ role: 'model', parts: msg._geminiParts });
                continue;
            }

            const parts = [];

            // Text content
            if (msg.content) {
                parts.push({ text: msg.content });
            }

            // Tool calls → functionCall parts (with optional thoughtSignature)
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    let args;
                    try {
                        args = typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments;
                    } catch {
                        args = {};
                    }
                    const fcPart = {
                        functionCall: {
                            name: tc.function.name,
                            args: args,
                        },
                    };
                    // Preserve thoughtSignature if stored from prior Gemini response
                    if (tc._thoughtSignature) {
                        fcPart.thoughtSignature = tc._thoughtSignature;
                    }
                    parts.push(fcPart);
                }
            }

            if (parts.length > 0) {
                contents.push({ role: 'model', parts });
            }
            continue;
        }

        if (msg.role === 'tool') {
            // Tool result → functionResponse part
            let responseObj;
            try {
                responseObj = typeof msg.content === 'string'
                    ? { result: msg.content }
                    : msg.content;
            } catch {
                responseObj = { result: String(msg.content) };
            }

            contents.push({
                role: 'user',
                parts: [{
                    functionResponse: {
                        name: msg.name || 'unknown_tool',
                        response: responseObj,
                    },
                }],
            });
            continue;
        }
    }

    // ── Post-process: merge consecutive same-role turns ──
    // Gemini strictly requires role alternation (user/model/user/model...).
    // After summarization or message deletion, we may end up with consecutive
    // model or user turns. Merge their parts into a single content entry.
    const merged = [];
    for (const entry of contents) {
        if (merged.length > 0 && merged[merged.length - 1].role === entry.role) {
            // Merge parts into the previous entry
            merged[merged.length - 1].parts.push(...entry.parts);
        } else {
            merged.push({ ...entry, parts: [...entry.parts] });
        }
    }

    // Gemini also requires the conversation to start with a 'user' turn.
    // If after merging it starts with 'model', insert a synthetic user turn.
    if (merged.length > 0 && merged[0].role === 'model') {
        merged.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
    }

    // ── Strip orphaned functionCall parts ──
    // Gemini requires every functionCall to be immediately followed by a
    // functionResponse turn. After summarization, older tool calls may lack
    // their paired responses. Remove functionCall (and thought/thoughtSignature)
    // parts from model turns that are NOT followed by a user turn containing
    // a functionResponse part.
    for (let i = 0; i < merged.length; i++) {
        if (merged[i].role !== 'model') continue;
        const hasFunctionCall = merged[i].parts.some(p => p.functionCall);
        if (!hasFunctionCall) continue;

        // Check if the next turn is a user turn with functionResponse
        const next = merged[i + 1];
        const hasMatchingResponse = next
            && next.role === 'user'
            && next.parts.some(p => p.functionResponse);

        if (!hasMatchingResponse) {
            // Strip functionCall and associated thought/thoughtSignature parts
            merged[i].parts = merged[i].parts.filter(
                p => !p.functionCall && !p.thoughtSignature
            );
            // If no parts remain, add placeholder text
            if (merged[i].parts.length === 0) {
                merged[i].parts = [{ text: '(processed)' }];
            }
        }
    }

    // Join all system messages with separators to form a single systemInstruction.
    // The main system prompt is always first; consciousness/context messages follow.
    const systemInstruction = systemParts.length > 0
        ? systemParts.join('\n\n---\n\n')
        : undefined;

    return { systemInstruction, contents: merged };
}

/**
 * Convert a Gemini generateContent response to OpenAI-compatible format
 * so the rest of the app can process it uniformly.
 *
 * IMPORTANT: For thinking models (gemini-3-*), the response may include
 * `thought` and `thoughtSignature` fields in parts. These MUST be preserved
 * and sent back in subsequent turns for function calling to work.
 * We store them as `_geminiParts` on the message object.
 */
export function geminiResponseToOpenai(geminiResponse) {
    const candidate = geminiResponse.candidates?.[0];
    if (!candidate) {
        return { choices: [] };
    }

    const parts = candidate.content?.parts || [];
    const message = { role: 'assistant' };

    // Collect text parts (exclude thought parts from visible content)
    const textParts = parts.filter(p => p.text && !p.thought).map(p => p.text);
    if (textParts.length > 0) {
        message.content = textParts.join('');
    } else {
        message.content = null;
    }

    // Collect function calls — preserve thoughtSignature for thinking models
    const functionCalls = parts.filter(p => p.functionCall);
    if (functionCalls.length > 0) {
        message.tool_calls = functionCalls.map((p, i) => ({
            id: `call_gemini_${Date.now()}_${i}`,
            type: 'function',
            function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args || {}),
            },
            // Preserve Gemini-specific fields for round-tripping
            _thoughtSignature: p.thoughtSignature || undefined,
        }));
    }

    // Preserve the FULL original parts array for faithful reconstruction
    // This ensures thought parts and thoughtSignatures survive the round-trip
    message._geminiParts = parts;

    return {
        choices: [{
            index: 0,
            message,
            finish_reason: candidate.finishReason || 'stop',
        }],
        usage: geminiResponse.usageMetadata ? {
            prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
            total_tokens: geminiResponse.usageMetadata.totalTokenCount || 0,
        } : undefined,
    };
}

// ─── Gemini SDK Calls ────────────────────────────────────────────────────

/**
 * Call Gemini using the @google/genai SDK
 */
export async function callGeminiSDK(ctx, requestBody, signal) {
    const ai = await getGeminiClient();
    const { systemInstruction, contents } = openaiMessagesToGemini(requestBody.messages);
    const geminiTools = openaiToolsToGemini(requestBody.tools);

    const generateConfig = {};
    
    if (requestBody.response_format) {
        if (requestBody.response_format.type === 'json_object') {
            generateConfig.responseMimeType = 'application/json';
        } else if (requestBody.response_format.type === 'json_schema') {
            generateConfig.responseMimeType = 'application/json';
            generateConfig.responseSchema = requestBody.response_format.schema;
        }
    }

    if (requestBody.temperature !== undefined) {
        generateConfig.temperature = requestBody.temperature;
    }
    if (requestBody.max_tokens) {
        generateConfig.maxOutputTokens = requestBody.max_tokens;
    }

    // Build tool config for auto tool choice
    if (geminiTools) {
        generateConfig.tools = geminiTools;
    }

    if (systemInstruction) {
        generateConfig.systemInstruction = systemInstruction;
    }

    // Race each attempt against a 60s per-call timeout to prevent indefinite hangs
    // when the network stalls without producing an error.
    const PER_CALL_TIMEOUT = 60_000;
    
    const geminiResponse = await withRetry(() => {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('fetch failed: Gemini SDK call timed out')), PER_CALL_TIMEOUT);
        });
        return withCancellation(Promise.race([
            ai.models.generateContent({
                model: ctx.model,
                contents: contents,
                config: generateConfig,
            }),
            timeoutPromise,
        ]), signal).finally(() => clearTimeout(timeoutId));
    });

    // Translate response to OpenAI format
    return geminiResponseToOpenai(geminiResponse);
}

/**
 * Call Gemini streaming using the @google/genai SDK.
 * Returns a synthetic Response object that mimics SSE streaming.
 */
export async function callGeminiSDKStream(ctx, requestBody, signal) {
    const ai = await getGeminiClient();
    const { systemInstruction, contents } = openaiMessagesToGemini(requestBody.messages);
    const geminiTools = openaiToolsToGemini(requestBody.tools);

    const generateConfig = {};
    if (requestBody.temperature !== undefined) {
        generateConfig.temperature = requestBody.temperature;
    }
    if (geminiTools) {
        generateConfig.tools = geminiTools;
    }
    if (systemInstruction) {
        generateConfig.systemInstruction = systemInstruction;
    }

    if (signal?.aborted) {
        throw signal.reason || new Error('Aborted');
    }

    // Do NOT wrap streaming calls in withRetry — if the stream partially sends
    // data then errors, a retry would create a second stream, leading to
    // duplicated/garbled output sent to the client.
    const streamResult = await ai.models.generateContentStream({
        model: ctx.model,
        contents: contents,
        config: generateConfig,
    });

    // Create a ReadableStream that wraps the Gemini async iterator
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            let closed = false;
            
            // Handle abort during stream
            let onAbort;
            if (signal) {
                onAbort = () => {
                    if (closed) return;
                    closed = true;
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    controller.error(err);
                };
                signal.addEventListener('abort', onAbort);
            }

            try {
                for await (const chunk of streamResult) {
                    if (signal?.aborted || closed) break;

                    const text = chunk.text || '';
                    if (text) {
                        // Emit SSE-formatted data matching OpenAI streaming format
                        const sseData = JSON.stringify({
                            choices: [{
                                delta: { content: text },
                                index: 0,
                            }],
                        });
                        controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                    }
                }
                if (!closed) {
                    closed = true;
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            } catch (err) {
                if (!closed) {
                    closed = true;
                    controller.error(err);
                }
            } finally {
                if (onAbort) signal.removeEventListener('abort', onAbort);
            }
        },
    });

    // Return a synthetic Response object
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
