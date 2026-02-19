// Quality evaluation system
// Handles response quality evaluation and retry logic

import { consoleStyler } from '../ui/console-styler.mjs';
import { ENHANCEMENT_TOOLS } from '../tools/tool-definitions.mjs';
import { callProvider } from '../core/ai-provider.mjs';

export class QualityEvaluator {
    constructor(endpoint) {
        this.endpoint = endpoint; // kept for backward compatibility
        this.qualityIssue = null;
        this.retryAttempts = 0;
        this.maxRetryAttempts = 2;
    }

    // Evaluate response quality using AI
    async evaluateResponse(userInput, finalResponse, toolCallsSummary, toolResults, createSystemPrompt, workingDir, workspace) {
        // Don't evaluate if we've already exceeded retry attempts
        if (this.retryAttempts >= this.maxRetryAttempts) {
            consoleStyler.log('quality', `Skipping quality evaluation - max retry attempts (${this.maxRetryAttempts}) reached`);
            return null;
        }

        consoleStyler.log('quality', 'Preparing comprehensive quality evaluation context...');

        // Create comprehensive context for quality evaluation
        let evaluationContext = `Evaluate this response using evaluate_response_quality tool.

QUERY: "${userInput}"
RESPONSE: "${finalResponse}"`;

        if (toolCallsSummary.length > 0) {
            evaluationContext += `\nTOOL CALLS (${toolCallsSummary.length} total):`;
            toolCallsSummary.forEach((call, i) => {
                evaluationContext += `\n${i + 1}. ${call.tool}(${Object.entries(call.parameters).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`;
            });

            if (toolResults.length > 0) {
                evaluationContext += `\nTOOL RESULTS:`;
                toolResults.forEach((result, i) => {
                    let resultStr = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
                    if (resultStr === undefined) resultStr = 'undefined';
                    evaluationContext += `\n${i + 1}. ${result.tool}: ${resultStr.substring(0, 200)}${resultStr.length > 200 ? '...' : ''}`;
                });
            }
        }

        evaluationContext += `

SCORING:
- 8-10 = Fully addresses query with correct tool usage
- 5-7 = Addresses query with minor issues
- 1-4 = Fails to address query

SCOPE VIOLATIONS (PENALIZE HEAVILY):
- Agent made >5 tool calls for a simple request → cap score at 4
- Agent took actions BEYOND what was asked → cap score at 3
- Agent continued after task was complete → cap score at 3

Evaluate BOTH text response AND tool usage. Successful tool calls count even if text is brief.
IF rating < 4: provide specific remedy.`;

        // Create a quality evaluation request
        const qualityCheckHistory = [
            { role: 'system', content: createSystemPrompt(workingDir, workspace) },
            {
                role: 'user',
                content: evaluationContext
            }
        ];

        consoleStyler.log('quality', `Evaluating response quality with ${toolCallsSummary.length} tool calls and ${toolResults.length} tool results`);
        
        try {
            // Import config dynamically to avoid circular dependencies
            const { config } = await import('../config.mjs');
            
            const qualityResult = await callProvider({
                model: config.ai.model,
                messages: qualityCheckHistory,
                tools: ENHANCEMENT_TOOLS,
                tool_choice: { type: "function", function: { name: "evaluate_response_quality" } },
                temperature: 0.1,
                reasoning_effort: "high"  // Quality evaluation always uses high reasoning
            });

            if (qualityResult && qualityResult.choices) {
                const qualityMessage = qualityResult.choices[0].message;
                
                if (qualityMessage.tool_calls && qualityMessage.tool_calls.length > 0) {
                    for (const toolCall of qualityMessage.tool_calls) {
                        if (toolCall.function.name === 'evaluate_response_quality') {
                            const args = JSON.parse(toolCall.function.arguments);
                            const { quality_rating = 0, evaluation_reasoning = "No reasoning provided", remedy_suggestion = "" } = args;
                            
                            consoleStyler.log('quality', `Quality evaluation results:`);
                            consoleStyler.log('quality', `   Rating: ${quality_rating}/10`, { indent: true });
                            if (evaluation_reasoning && typeof evaluation_reasoning === 'string') {
                                consoleStyler.log('quality', `   Reasoning: ${evaluation_reasoning.substring(0, 100)}...`, { indent: true });
                            }
                            if (remedy_suggestion && typeof remedy_suggestion === 'string') {
                                consoleStyler.log('quality', `   Remedy: ${remedy_suggestion.substring(0, 100)}...`, { indent: true });
                            }
                            
                            return {
                                rating: quality_rating,
                                reasoning: evaluation_reasoning,
                                remedy: remedy_suggestion,
                                needsRetry: quality_rating < 4 && remedy_suggestion
                            };
                        }
                    }
                }
            }
        } catch (qualityError) {
            consoleStyler.log('error', `Quality evaluation failed: ${qualityError.message}`, { box: true });
        }

        consoleStyler.log('quality', 'Quality evaluation completed with no actionable results');
        return null;
    }

    // Check if retry is needed based on quality evaluation
    shouldRetry(qualityResult) {
        if (!qualityResult || !qualityResult.needsRetry) {
            return false;
        }

        if (this.retryAttempts >= this.maxRetryAttempts) {
            consoleStyler.log('quality', `Maximum retry attempts (${this.maxRetryAttempts}) reached`);
            return false;
        }

        return true;
    }

    // Create improved prompt for retry
    createRetryPrompt(userInput, finalResponse, qualityResult) {
        this.retryAttempts++;
        
        consoleStyler.log('quality', `Poor quality detected (${qualityResult.rating}/10)`, { box: true });
        consoleStyler.log('quality', `Remedy: ${qualityResult.remedy}`);
        
        // Store quality issue for reference
        this.qualityIssue = {
            rating: qualityResult.rating,
            reasoning: qualityResult.reasoning,
            remedy: qualityResult.remedy,
            original_query: userInput,
            poor_response: finalResponse
        };
        
        // Create improved prompt with remedy
        const improvedPrompt = `${userInput}

PREVIOUS RESPONSE FAILED (${qualityResult.rating}/10):
"${finalResponse}"

REQUIRED FIX: ${qualityResult.remedy}

SCOPE: Address ONLY the original request. Do NOT add unrequested actions.`;
        
        return improvedPrompt;
    }

    // Reset quality evaluation state
    reset() {
        this.qualityIssue = null;
        this.retryAttempts = 0;
    }

    // Get current quality issue
    getQualityIssue() {
        return this.qualityIssue;
    }

    // Get retry attempt count
    getRetryAttempts() {
        return this.retryAttempts;
    }

    // Set quality issue manually (for tool execution)
    setQualityIssue(issue) {
        this.qualityIssue = issue;
    }

    // Check if we're currently in a retry situation
    isRetrying() {
        return this.retryAttempts > 0;
    }

    // Get quality evaluation summary for logging
    getQualitySummary() {
        if (!this.qualityIssue) {
            return "No quality issues detected";
        }
        
        return `Quality issue: ${this.qualityIssue.rating}/10 - ${this.qualityIssue.remedy}`;
    }

    // Handle quality evaluation result from tool execution
    handleQualityToolResult(args) {
        const { quality_rating = 0, evaluation_reasoning = "No reasoning", remedy_suggestion = "" } = args;
        
        if (quality_rating < 4) {
            console.log(`\x1b[31m[QUALITY] Poor quality detected (${quality_rating}/10)\x1b[0m`);
            if (remedy_suggestion) {
                console.log(`\x1b[33m[QUALITY] Remedy: ${remedy_suggestion}\x1b[0m`);
            }
            
            // Store quality issue for retry
            this.qualityIssue = {
                rating: quality_rating,
                reasoning: evaluation_reasoning,
                remedy: remedy_suggestion
            };
            
            return `Quality rating ${quality_rating}/10 - retry needed with remedy: ${remedy_suggestion}`;
        } else {
            return `Quality rating ${quality_rating}/10 - response approved`;
        }
    }

    // Extract tool call summary for quality evaluation
    extractToolCallsSummary(history) {
        return history
            .filter(msg => msg.tool_calls && msg.tool_calls.length > 0)
            .map(msg => msg.tool_calls.map(call => ({
                tool: call.function.name,
                parameters: JSON.parse(call.function.arguments)
            })))
            .flat();
    }

    // Extract tool results for quality evaluation
    extractToolResults(history) {
        return history
            .filter(msg => msg.role === 'tool')
            .map(msg => ({
                tool: msg.name,
                result: msg.content
            }));
    }
}