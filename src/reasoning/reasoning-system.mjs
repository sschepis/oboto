// Reasoning system for determining appropriate effort levels
// This module handles all logic related to determining how much reasoning effort to apply

import { consoleStyler } from '../ui/console-styler.mjs';

export class ReasoningSystem {
    constructor() {
        this.errorHistory = [];
        this.predictedReasoning = null;
        this.reasoningJustification = null;
    }

    // Determine reasoning effort based on task complexity
    determineReasoningEffort(userInput, context = {}) {
        // Check for user preference first
        const userPreference = this.parseUserReasoningPreference(userInput);
        if (userPreference) return userPreference;

        // Check for complexity indicators
        const complexityIndicators = {
            high: [
                /debug|troubleshoot|analyze error/i,
                /architect|design|plan/i,
                /optimize|refactor|improve performance/i,
                /complex|complicated|multi-step/i,
                /why|explain|understand/i,
                /embellish|enhance|improve/i
            ],
            medium: [
                /create|build|implement/i,
                /fix|solve|resolve/i,
                /convert|transform/i,
                /test|validate/i,
                /fetch|scrape|extract/i
            ],
            low: [
                /simple|basic|quick/i,
                /list|show|display/i,
                /check|verify/i,
                /format|clean/i,
                /update status/i
            ]
        };
        
        // Check if we're in a recovery/retry situation
        if (context.isRetry || context.errorCount > 0) {
            consoleStyler.log('reasoning', 'Using high effort due to retry/error context');
            return "high";
        }
        
        // Check if we have a todo list with many steps
        if (context.todoCount && context.todoCount > 5) {
            consoleStyler.log('reasoning', 'Using high effort due to complex multi-step task');
            return "high";
        }
        
        // Pattern matching
        for (const [level, patterns] of Object.entries(complexityIndicators)) {
            if (patterns.some(pattern => pattern.test(userInput))) {
                consoleStyler.log('reasoning', `Detected ${level} complexity from input patterns`);
                return level;
            }
        }
        
        return "medium"; // Default
    }

    // Parse user preference for reasoning level
    parseUserReasoningPreference(userInput) {
        const reasoningHints = {
            high: /\b(carefully|thoroughly|deeply|detailed|comprehensive)\b/i,
            low: /\b(quickly|briefly|simple|fast|quick)\b/i
        };
        
        for (const [level, pattern] of Object.entries(reasoningHints)) {
            if (pattern.test(userInput)) {
                consoleStyler.log('reasoning', `User requested ${level} effort`);
                return level;
            }
        }
        
        return null; // No preference detected
    }

    // Get adaptive reasoning based on error history
    getAdaptiveReasoningEffort() {
        const recentErrors = this.errorHistory.filter(err => {
            const errorTime = new Date(err.timestamp);
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            return errorTime > fiveMinutesAgo;
        });
        
        if (recentErrors.length >= 3) {
            consoleStyler.log('reasoning', `Using high effort due to ${recentErrors.length} recent errors`);
            return "high";
        }
        if (recentErrors.length >= 1) {
            consoleStyler.log('reasoning', 'Using medium effort due to recent errors');
            return "medium";
        }
        return "low";
    }

    // Get tool-specific reasoning level
    getToolSpecificReasoning(toolName) {
        const toolReasoningMap = {
            'analyze_and_recover': 'high',      // Error recovery needs deep thinking
            'embellish_request': 'high',        // Planning needs thorough analysis
            'execute_javascript': 'medium',      // Code execution is straightforward
            'create_todo_list': 'high',         // Planning multi-step tasks
            'update_todo_status': 'low',        // Simple status update
            'evaluate_response_quality': 'high' // Quality evaluation needs careful analysis
        };
        
        const level = toolReasoningMap[toolName] || 'medium';
        consoleStyler.log('reasoning', `Using ${level} effort for tool: ${toolName}`);
        return level;
    }

    // Get context-aware reasoning based on conversation state
    getContextAwareReasoning(context = {}) {
        const { historyLength = 0, toolCallCount = 0, pendingSteps = 0 } = context;
        
        // Long conversations might need more reasoning
        if (historyLength > 20) {
            consoleStyler.log('reasoning', 'Using high effort due to long conversation history');
            return "high";
        }
        
        // Multiple tool calls in history suggest complex task
        if (toolCallCount > 5) {
            consoleStyler.log('reasoning', 'Using high effort due to multiple tool calls');
            return "high";
        }
        
        // Check if we're in the middle of a multi-step process
        if (pendingSteps > 3) {
            consoleStyler.log('reasoning', `Using high effort due to ${pendingSteps} pending steps`);
            return "high";
        }
        
        return "medium";
    }

    // Combine all reasoning strategies to determine final effort level
    determineOptimalReasoning(userInput = null, toolName = null, context = {}) {
        // Priority order for reasoning determination
        // 1. Tool-specific reasoning (if tool is being used)
        if (toolName) {
            return this.getToolSpecificReasoning(toolName);
        }
        
        // 2. Error-based adaptive reasoning
        const errorBasedReasoning = this.getAdaptiveReasoningEffort();
        if (errorBasedReasoning === "high") {
            return errorBasedReasoning;
        }
        
        // 3. Context-aware reasoning
        const contextReasoning = this.getContextAwareReasoning(context);
        if (contextReasoning === "high") {
            return contextReasoning;
        }
        
        // 4. Task complexity reasoning
        const complexityReasoning = this.determineReasoningEffort(userInput || '', {
            isRetry: context.retryAttempts > 0,
            errorCount: this.errorHistory.length,
            todoCount: context.todoCount
        });
        
        // Return the highest reasoning level among all strategies
        const levels = [errorBasedReasoning, contextReasoning, complexityReasoning];
        if (levels.includes("high")) return "high";
        if (levels.includes("medium")) return "medium";
        return "low";
    }

    // Add error to history for adaptive reasoning
    addError(error) {
        this.errorHistory.push({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }

    // Set predicted reasoning from embellishment
    setPredictedReasoning(reasoning, justification) {
        this.predictedReasoning = reasoning;
        this.reasoningJustification = justification;
        consoleStyler.log('reasoning', `Predicted: ${reasoning} - ${justification}`);
    }

    // Get predicted reasoning
    getPredictedReasoning() {
        return this.predictedReasoning;
    }

    // Get simplified reasoning with minimal logic for performance
    getSimplifiedReasoning(userInput = '', context = {}) {
        // Critical overrides only
        const recentErrors = this.errorHistory.filter(err => {
            const errorTime = new Date(err.timestamp);
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            return errorTime > fiveMinutesAgo;
        }).length;
        
        if (recentErrors >= 2) {
            consoleStyler.log('reasoning', `Override: high due to ${recentErrors} recent errors`);
            return "high";
        }
        
        if (context.toolName === 'analyze_and_recover' || context.toolName === 'evaluate_response_quality') {
            consoleStyler.log('reasoning', `Override: high for ${context.toolName}`);
            return "high";
        }
        
        if (this.predictedReasoning) {
            consoleStyler.log('reasoning', `Using predicted: ${this.predictedReasoning}`);
            return this.predictedReasoning;
        }
        
        // Default fallback
        consoleStyler.log('reasoning', 'Using default: medium');
        return "medium";
    }

    // Reset reasoning state
    reset() {
        this.predictedReasoning = null;
        this.reasoningJustification = null;
    }

    // Simple heuristic-based reasoning prediction as fallback
    predictReasoningFromInput(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        if (lowerInput.includes('quickly') || lowerInput.includes('quick') || 
            lowerInput.includes('fast') || lowerInput.includes('briefly')) {
            this.predictedReasoning = 'low';
            consoleStyler.log('reasoning', 'Detected user preference: low (quick/fast)');
        } else if (lowerInput.includes('thoroughly') || lowerInput.includes('detailed') ||
                   lowerInput.includes('comprehensive') || lowerInput.includes('carefully')) {
            this.predictedReasoning = 'high';
            consoleStyler.log('reasoning', 'Detected user preference: high (thorough/detailed)');
        } else if (lowerInput.includes('debug') || lowerInput.includes('analyze') ||
                   lowerInput.includes('troubleshoot') || lowerInput.includes('complex')) {
            this.predictedReasoning = 'high';
            consoleStyler.log('reasoning', 'Detected complexity: high (debug/analyze)');
        } else if (lowerInput.includes('simple') || lowerInput.includes('basic') ||
                   lowerInput.includes('count') || lowerInput.includes('list')) {
            this.predictedReasoning = 'low';
            consoleStyler.log('reasoning', 'Detected simplicity: low (simple/basic)');
        }
        
        return this.predictedReasoning;
    }
}