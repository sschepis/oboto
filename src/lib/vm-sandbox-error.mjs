/**
 * Error thrown when AI-generated code fails inside the VM2 sandbox.
 * Used to distinguish sandbox execution failures from real application errors
 * in the process-level unhandled rejection handler.
 */
export class VmSandboxError extends Error {
    constructor(message = 'VM2 sandbox execution failed') {
        super(message);
        this.name = 'VmSandboxError';
    }
}
