import { FileTools } from '../tools/file-tools.mjs';

/**
 * Generates tutorials from session history.
 */
export class TutorialGenerator {
    /**
     * @param {HistoryManager} historyManager 
     * @param {string} workspaceRoot 
     */
    constructor(historyManager, workspaceRoot) {
        this.historyManager = historyManager;
        this.fileTools = new FileTools(workspaceRoot);
    }

    /**
     * Generates a markdown tutorial based on the session history.
     * @param {string} title - Title of the tutorial
     * @returns {Promise<string>} Markdown content
     */
    async generateTutorial(title) {
        if (!this.historyManager) {
            return "Error: History manager is not available. Cannot generate tutorial from history.";
        }

        const history = this.historyManager.getHistory();
        let markdown = `# ${title}\n\n`;
        markdown += `*Auto-generated tutorial based on session history.*\n\n`;

        let stepCount = 1;

        for (const msg of history) {
            if (msg.role === 'user') {
                markdown += `## Step ${stepCount}: User Request\n\n`;
                markdown += `${msg.content}\n\n`;
                stepCount++;
            } else if (msg.role === 'assistant') {
                if (msg.content) {
                    markdown += `### Assistant Response\n\n`;
                    markdown += `${msg.content}\n\n`;
                }
                
                if (msg.tool_calls) {
                    for (const toolCall of msg.tool_calls) {
                        markdown += `### Action: \`${toolCall.function.name}\`\n\n`;
                        markdown += `Arguments:\n\`\`\`json\n${toolCall.function.arguments}\n\`\`\`\n\n`;
                    }
                }
            } else if (msg.role === 'tool') {
                // Optionally include tool outputs, but they can be large.
                // Let's include a summary or truncated output.
                const output = msg.content.length > 500 ? msg.content.substring(0, 500) + '... (truncated)' : msg.content;
                markdown += `> **Result:** ${output}\n\n`;
            }
        }

        return markdown;
    }
}
