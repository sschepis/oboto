import { consoleStyler } from '../ui/console-styler.mjs';
import { emitStatus } from './status-reporter.mjs';
import { TASK_ROLES, fitToBudget } from './prompt-router.mjs';

/**
 * Handles streaming execution for the AI Assistant.
 * 
 * P2 optimization: Uses a single LLM call per turn instead of making a 
 * non-streaming call followed by a redundant streaming call for the final response.
 * 
 * P3 optimization: Removed redundant enhanceMessagesWithWorkReporting — the 
 * work reporting instruction is already in the system prompt.
 * 
 * @param {Object} context - The MiniAIAssistant instance context
 * @param {string} userInput - The user's input
 * @param {Function} onChunk - Callback for each chunk of streamed content
 * @param {Object} options - Options object { signal }
 * @returns {Promise<string>} The final response content
 */
export async function runStreamHandler(context, userInput, onChunk, options = {}) {
    const { 
        signal, 
        maxTurns, 
        historyManager, 
        qualityEvaluator, 
        reasoningSystem, 
        toolExecutor,
        llmAdapter,
        model, // Default model (fallback)
        temperature,
        allTools,
        promptRouter, // New: Prompt Router injection
        symbolicContinuity // Symbolic Continuity Manager
    } = context;

    // Check for cancellation before starting
    if (signal?.aborted) {
        throw new DOMException('Agent execution was cancelled', 'AbortError');
    }

    // ── Symbolic Continuity Injection ──
    if (symbolicContinuity) {
        const continuityMsg = symbolicContinuity.renderInjectionMessage();
        if (continuityMsg) {
            historyManager.addMessage('system', continuityMsg);
        }
    }

    historyManager.addMessage('user', userInput);
    qualityEvaluator.reset();
    reasoningSystem.reset();

    // Predict reasoning from input
    reasoningSystem.predictReasoningFromInput(userInput);

    let reasoning = reasoningSystem.getSimplifiedReasoning('', {});

    // Determine model role
    let role = TASK_ROLES.AGENTIC;
    if (reasoning === 'high') role = TASK_ROLES.REASONING_HIGH;
    if (reasoning === 'low') role = TASK_ROLES.REASONING_LOW;

    try {
        for (let i = 0; i < maxTurns; i++) {
            // Check for cancellation at the start of each turn
            if (signal?.aborted) {
                throw new DOMException('Agent execution was cancelled', 'AbortError');
            }

            consoleStyler.log('progress', `Processing turn ${i + 1}/${maxTurns}`, { timestamp: true });
            emitStatus(i === 0 ? 'Thinking…' : `Continuing work (turn ${i + 1}/${maxTurns})…`);

            // Resolve model via router if available, otherwise fallback to context.model
            let modelId = model;
            let supportsReasoningEffort = false;
            let contextWindow = 128000;
            let maxOutputTokens = 8192;

            if (promptRouter) {
                const config = promptRouter.resolveModel(role);
                modelId = config.modelId;
                supportsReasoningEffort = config.supportsReasoningEffort;
                contextWindow = config.contextWindow;
                maxOutputTokens = config.maxOutputTokens;
                
                // Fallback for tool capability
                if (role === TASK_ROLES.REASONING_HIGH && !config.supportsToolCalling) {
                    const agentic = promptRouter.resolveModel(TASK_ROLES.AGENTIC);
                    modelId = agentic.modelId;
                    supportsReasoningEffort = agentic.supportsReasoningEffort;
                    contextWindow = agentic.contextWindow;
                    maxOutputTokens = agentic.maxOutputTokens;
                }
            }

            // P3: Use history directly — work reporting instruction is in the system prompt
            const history = [...historyManager.getHistory()];
            
            // Apply token budget
            const { messages: budgetedMessages, trimmed } = fitToBudget(history, contextWindow, maxOutputTokens);
            
            if (trimmed) {
                consoleStyler.log('routing', `History trimmed to fit context window (${budgetedMessages.length} messages)`);
            }

            const requestData = {
                model: modelId,
                messages: budgetedMessages,
                tools: allTools,
                tool_choice: "auto",
                temperature: temperature,
                reasoning_effort: supportsReasoningEffort ? reasoning : undefined,
            };

            const result = await llmAdapter.generateContent(requestData, { signal });

            if (!result.choices || result.choices.length === 0) {
                const fallback = "Invalid response from AI provider.";
                onChunk(fallback);
                return fallback;
            }

            const message = result.choices[0].message;

            if (message.tool_calls && message.tool_calls.length > 0) {
                // Handle tool calls (same loop as run())
                const toolNames = message.tool_calls.map(tc => tc.function.name).join(', ');
                consoleStyler.log('tools', `Executing tool(s): ${toolNames}`);
                emitStatus(`Executing ${message.tool_calls.length} tool(s)…`);

                historyManager.pushMessage(message);

                for (const toolCall of message.tool_calls) {
                    consoleStyler.log('working', `Executing: ${toolCall.function.name}`);

                    const toolResult = await toolExecutor.executeTool(toolCall, { signal });
                    const success = !toolResult.content.startsWith('Error:');
                    if (success) {
                        consoleStyler.log('tools', `✓ ${toolCall.function.name}`);
                    } else {
                        consoleStyler.log('error', `✗ ${toolCall.function.name} - ${toolResult.content.substring(0, 80)}...`);
                    }
                    historyManager.pushMessage(toolResult);
                }
                consoleStyler.log('tools', 'All tool calls completed. Continuing...');
                continue;
            } else {
                // P2 optimization: We already have the full text response from the 
                // non-streaming call. Emit it directly to onChunk instead of making 
                // a second redundant streaming LLM call.
                const content = message.content || '';
                onChunk(content);
                historyManager.addMessage('assistant', content);

                // ── Symbolic Continuity Generation ──
                if (symbolicContinuity && symbolicContinuity.shouldGenerate(userInput, content, 0)) {
                    // Count tool calls from this streaming run
                    const streamHistory = historyManager.getHistory();
                    const lastUserIdx = streamHistory.map(m => m.role).lastIndexOf('user');
                    const turnMsgs = lastUserIdx >= 0 ? streamHistory.slice(lastUserIdx) : [];
                    const tcCount = turnMsgs.filter(m => m.tool_calls).length;
                    await symbolicContinuity.generateSignature(userInput, content, tcCount);
                }

                return content;
            }
        }

        const fallback = "Could not determine a response after multiple turns.";
        onChunk(fallback);
        return fallback;

    } catch (error) {
        consoleStyler.log('error', `Request failed: ${error.message}`);
        const errMsg = `Error: ${error.message}`;
        onChunk(errMsg);
        return errMsg;
    }
}
