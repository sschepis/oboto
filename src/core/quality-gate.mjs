import { consoleStyler } from '../ui/console-styler.mjs';
import { createSystemPrompt } from './system-prompt.mjs';

/**
 * Encapsulates response quality evaluation logic.
 */
export class QualityGate {
    constructor(qualityEvaluator, historyManager, workingDir, workspaceManager) {
        this.qualityEvaluator = qualityEvaluator;
        this.historyManager = historyManager;
        this.workingDir = workingDir;
        this.workspaceManager = workspaceManager;
    }

    /**
     * Determines whether quality evaluation should be skipped for simple responses.
     * Avoids an expensive LLM call when the response is clearly adequate.
     * @param {string} userInput - The original user input
     * @param {string} finalResponse - The assistant's final response
     * @param {Array<Object>} history - The conversation history
     * @returns {boolean} True if quality evaluation should be skipped
     */
    _shouldSkipEvaluation(userInput, finalResponse, history) {
        // Count tool calls in this conversation turn (after the last user message)
        const lastUserIndex = history.map(m => m.role).lastIndexOf('user');
        const turnMessages = lastUserIndex >= 0 ? history.slice(lastUserIndex) : [];
        const toolCallCount = turnMessages.filter(m => m.tool_calls).length;

        // Skip for simple Q&A with no tool usage and short responses
        if (toolCallCount === 0 && finalResponse.length < 500) {
            consoleStyler.log('quality', '⏩ Skipping quality evaluation — simple response with no tool calls');
            return true;
        }

        // Skip for very short user inputs (greetings, single-word queries)
        if (userInput.trim().length < 15) {
            consoleStyler.log('quality', '⏩ Skipping quality evaluation — trivial user input');
            return true;
        }

        return false;
    }

    /**
     * Evaluates the quality of a response and determines if a retry is needed.
     * @param {string} userInput - The original user input
     * @param {string} finalResponse - The assistant's final response
     * @returns {Promise<Object|null>} Retry configuration or null if approved
     */
    async evaluateAndCheckRetry(userInput, finalResponse) {
        const history = this.historyManager.getHistory();

        // P0 optimization: skip quality evaluation for simple responses
        if (this._shouldSkipEvaluation(userInput, finalResponse, history)) {
            return null;
        }

        consoleStyler.log('quality', 'Initiating response quality evaluation...', { timestamp: true });
        
        const toolCallsSummary = this.qualityEvaluator.extractToolCallsSummary(history);
        const toolResults = this.qualityEvaluator.extractToolResults(history);
        
        const qualityResult = await this.qualityEvaluator.evaluateResponse(
            userInput,
            finalResponse,
            toolCallsSummary,
            toolResults,
            createSystemPrompt,
            this.workingDir,
            this.workspaceManager.getCurrentWorkspace()
        );
        
        if (qualityResult) {
            const rating = qualityResult.rating !== undefined ? qualityResult.rating : 0;
            consoleStyler.log('quality', `Quality evaluation complete: ${rating}/10`);
            
            if (this.qualityEvaluator.shouldRetry(qualityResult)) {
                consoleStyler.log('quality', `Quality below threshold (${rating}/10). Initiating retry...`, { box: true });
                consoleStyler.log('quality', `Remedy: ${qualityResult.remedy}`);
                
                const improvedPrompt = this.qualityEvaluator.createRetryPrompt(
                    userInput,
                    finalResponse,
                    qualityResult
                );
                
                // Preserve tool call history but reset conversation for retry
                const systemPrompt = {
                    role: 'system',
                    content: createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace())
                };
                
                // Keep all tool calls and results, but remove the final poor-quality response
                // We do this logic here to return the clean state for the caller
                // CRITICAL FIX: Sanitize assistant messages with tool calls to remove hallucinated text instructions
                const preservedHistory = history.filter(msg =>
                    msg.role === 'system' ||
                    msg.role === 'tool' ||
                    (msg.role === 'assistant' && msg.tool_calls) ||
                    msg.role === 'user'
                ).map(msg => {
                    if (msg.role === 'assistant' && msg.tool_calls) {
                         // Return a copy with empty content to prevent instruction leakage/hallucination loops
                         return { ...msg, content: null };
                    }
                    return msg;
                });
                
                return {
                    improvedPrompt,
                    preservedHistory: [systemPrompt, ...preservedHistory.slice(1)],
                    remedy: qualityResult.remedy
                };
            } else {
                consoleStyler.log('quality', `✓ Response quality approved (${rating}/10)`);
            }
        } else {
            consoleStyler.log('quality', 'Quality evaluation skipped or failed');
        }
        
        return null;
    }
}
