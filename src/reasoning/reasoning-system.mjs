// Reasoning system for determining appropriate effort levels
// This module handles all logic related to determining how much reasoning effort to apply
//
// P6 optimization: Removed unused methods (determineReasoningEffort, getAdaptiveReasoningEffort, 
// getToolSpecificReasoning, getContextAwareReasoning, determineOptimalReasoning, 
// parseUserReasoningPreference). The main loop only uses predictReasoningFromInput() + 
// getSimplifiedReasoning().

import { consoleStyler } from '../ui/console-styler.mjs';

export class ReasoningSystem {
    constructor() {
        this.errorHistory = [];
        this.predictedReasoning = null;
        this.reasoningJustification = null;
    }

    // Get simplified reasoning with minimal logic for performance
    // This is the primary method used by the main assistant loop
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

    // Add error to history for adaptive reasoning
    addError(error) {
        this.errorHistory.push({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }

    // Set predicted reasoning (used by external callers if needed)
    setPredictedReasoning(reasoning, justification) {
        this.predictedReasoning = reasoning;
        this.reasoningJustification = justification;
        consoleStyler.log('reasoning', `Predicted: ${reasoning} - ${justification}`);
    }

    // Get predicted reasoning
    getPredictedReasoning() {
        return this.predictedReasoning;
    }

    // Reset reasoning state
    reset() {
        this.predictedReasoning = null;
        this.reasoningJustification = null;
    }

    // Simple heuristic-based reasoning prediction from user input
    // Called at the start of run() to set predicted reasoning level
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
