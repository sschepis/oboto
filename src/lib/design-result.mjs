/**
 * Result returned by AiMan.design().
 * Contains the structured design document and metadata needed by implement().
 */
export class DesignResult {
    /**
     * @param {Object} params
     * @param {string} params.task - The original task description
     * @param {string} params.document - The full design document produced by the agent
     * @param {string} params.workingDir - The working directory used during design
     */
    constructor({ task, document, workingDir }) {
        this.task = task;
        this.document = document;
        this.workingDir = workingDir;
        this.createdAt = new Date().toISOString();
    }
}
