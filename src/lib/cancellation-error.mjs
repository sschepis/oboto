/**
 * Error thrown when an agent execution is cancelled via AbortSignal.
 */
export class CancellationError extends Error {
    constructor(message = 'Agent execution was cancelled') {
        super(message);
        this.name = 'CancellationError';
    }
}
