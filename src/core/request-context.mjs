// RequestContext — Isolated per-request state for the assistant pipeline.
// Each incoming request gets its own context object. No shared mutable state
// between concurrent requests.

import crypto from 'crypto';

export class RequestContext {
    /**
     * @param {Object} options
     * @param {string} options.userInput - The user's message
     * @param {AbortSignal} [options.signal] - AbortSignal for cancellation
     * @param {boolean} [options.stream=false] - Whether to stream the response
     * @param {Function} [options.onChunk] - Streaming callback (chunk) => void
     * @param {string} [options.model] - Model override
     * @param {Object} [options.responseFormat] - Structured output format
     * @param {boolean} [options.isRetry=false] - Whether this is a retry attempt
     * @param {number} [options.retryCount=0] - Current retry count
     * @param {boolean} [options.dryRun=false] - Dry-run mode
     * @param {string} [options.surfaceId] - Active surface ID
     * @param {number} [options.maxTurns=100] - Maximum agent loop turns
     * @param {string} [options.conversationName] - Target conversation name
     */
    constructor(options = {}) {
        // Identity
        this.id = crypto.randomUUID();

        // Input
        this.userInput = options.userInput || '';
        this.originalInput = options.userInput || ''; // Preserved even if userInput is modified

        // Control
        this.signal = options.signal || null;
        this.stream = options.stream || false;
        this.onChunk = options.onChunk || null;
        this.model = options.model || null;
        this.responseFormat = options.responseFormat || null;
        this.isRetry = options.isRetry || false;
        this.retryCount = options.retryCount || 0;
        this.dryRun = options.dryRun || false;
        this.surfaceId = options.surfaceId || null;
        this.conversationName = options.conversationName || null;

        // Agent loop state
        this.turnNumber = 0;
        this.maxTurns = options.maxTurns || 100;
        this.toolCallCount = 0;

        // Result
        this.finalResponse = null;
        this.triageResult = null; // Result from triage stage

        // Errors accumulated during processing
        this.errors = [];

        // Arbitrary per-request metadata (stages can attach data here)
        this.metadata = {};

        // Timing
        this.startedAt = Date.now();
        this.completedAt = null;

        // Pipeline control flags
        this._skipToFinalize = false; // Set by triage fast-path
    }

    /**
     * Check if the request has been aborted.
     * @returns {boolean}
     */
    get aborted() {
        return this.signal?.aborted || false;
    }

    /**
     * Throw if the request has been aborted.
     * @throws {DOMException} AbortError
     */
    throwIfAborted() {
        if (this.aborted) {
            throw new DOMException('Agent execution was cancelled', 'AbortError');
        }
    }

    /**
     * Record an error that occurred during processing.
     * @param {Error} error
     * @param {string} [phase] - Pipeline phase where the error occurred
     */
    addError(error, phase = null) {
        this.errors.push({
            message: error.message,
            phase,
            timestamp: Date.now(),
        });
    }

    /**
     * Mark the request as completed.
     */
    complete() {
        this.completedAt = Date.now();
    }

    /**
     * Get elapsed time in milliseconds.
     * @returns {number}
     */
    get elapsed() {
        return (this.completedAt || Date.now()) - this.startedAt;
    }

    /**
     * Create a retry context from this context.
     * @param {string} improvedPrompt - The improved prompt for the retry
     * @returns {RequestContext}
     */
    createRetryContext(improvedPrompt) {
        return new RequestContext({
            userInput: improvedPrompt,
            signal: this.signal,
            stream: this.stream,
            onChunk: this.onChunk,
            model: this.model,
            responseFormat: this.responseFormat,
            isRetry: true,
            retryCount: this.retryCount + 1,
            dryRun: this.dryRun,
            surfaceId: this.surfaceId,
            maxTurns: this.maxTurns,
            conversationName: this.conversationName,
        });
    }
}
