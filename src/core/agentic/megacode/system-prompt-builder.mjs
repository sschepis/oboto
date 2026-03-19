/**
 * SystemPromptBuilder — builds the system prompt for the megacode ReAct loop.
 *
 * Assembles a layered system prompt that instructs the LLM to:
 * 1. Act as a coding assistant with tool-use capabilities
 * 2. Use a structured JSON format for actions (tool_call or respond)
 * 3. Follow the ReAct pattern: Thought → Action → Observation
 * 4. Not fabricate tool results — wait for actual execution
 *
 * @module src/core/agentic/megacode/system-prompt-builder
 */

export class SystemPromptBuilder {
    /**
     * Build the complete system prompt for the megacode ReAct loop.
     *
     * @param {Object} [options]
     * @param {string} [options.workingDir]      — current working directory
     * @param {Array}  [options.tools]           — available tool definitions
     * @param {string} [options.agentPrompt]     — custom agent-specific instructions
     * @param {string} [options.soulPrompt]      — core identity prompt
     * @param {string} [options.customInstructions] — user/workspace custom instructions
     * @returns {string} — the assembled system prompt
     */
    static build(options = {}) {
        const parts = [];

        // 1. Core identity (soul prompt override, or default)
        if (options.soulPrompt) {
            parts.push(options.soulPrompt);
        }

        // 2. Agent-specific instructions (override, or default)
        if (options.agentPrompt) {
            parts.push(options.agentPrompt);
        }

        // 3. Core ReAct agent prompt
        parts.push(SystemPromptBuilder.getCorePrompt());

        // 4. Tool descriptions section
        if (options.tools && options.tools.length > 0) {
            parts.push(SystemPromptBuilder.buildToolSection(options.tools));
        }

        // 5. Environment context
        parts.push(SystemPromptBuilder.buildEnvironmentSection(options.workingDir));

        // 6. Custom instructions (workspace-level)
        if (options.customInstructions) {
            parts.push(`## Custom Instructions\n${options.customInstructions}`);
        }

        return parts.filter(Boolean).join('\n\n');
    }

    /**
     * Build tool descriptions section from available tool definitions.
     *
     * Tool definitions follow OpenAI's function-calling format:
     *   { type: 'function', function: { name, description, parameters } }
     *
     * @param {Array} tools
     * @returns {string}
     */
    static buildToolSection(tools) {
        if (!tools || tools.length === 0) return '';

        const toolDescriptions = tools.map(tool => {
            const fn = tool.function || tool;
            const name = fn.name || 'unknown';
            const desc = fn.description || 'No description';
            const params = fn.parameters?.properties
                ? Object.entries(fn.parameters.properties).map(([key, val]) => {
                    const required = fn.parameters.required?.includes(key) ? ' (required)' : '';
                    return `    - ${key}: ${val.description || val.type || 'any'}${required}`;
                }).join('\n')
                : '    (no parameters)';
            return `- **${name}**: ${desc}\n${params}`;
        });

        return `## Available Tools\n\nYou have access to the following tools:\n\n${toolDescriptions.join('\n\n')}`;
    }

    /**
     * Build environment context section.
     *
     * @param {string} [workingDir]
     * @returns {string}
     */
    static buildEnvironmentSection(workingDir) {
        const lines = ['## Environment'];
        if (workingDir) {
            lines.push(`- Working directory: ${workingDir}`);
        }
        lines.push(`- Platform: ${typeof process !== 'undefined' ? process.platform : 'unknown'}`);
        lines.push(`- Current time: ${new Date().toISOString()}`);
        return lines.join('\n');
    }

    /**
     * Get the core agent identity/instructions prompt.
     *
     * Instructs the LLM to use the ReAct pattern with structured JSON
     * actions for tool calls and final responses.
     *
     * @returns {string}
     */
    static getCorePrompt() {
        return `You are a highly capable coding assistant with tool-use capabilities. You solve problems step by step using a structured Thought → Action → Observation loop.

## Action Format

You MUST respond with a JSON object specifying your action. There are two action types:

### 1. Tool Call — execute a tool
\`\`\`json
{
  "action": "tool_call",
  "tool": "tool_name",
  "args": { "param1": "value1", "param2": "value2" }
}
\`\`\`

### 2. Final Response — reply to the user
\`\`\`json
{
  "action": "respond",
  "response": "Your final answer to the user's question."
}
\`\`\`

## Rules

1. **Think step by step.** Before each action, reason about what you need to do and why. Include your reasoning as a "thought" field if helpful.
2. **One action per turn.** Each response must contain exactly ONE action — either a tool_call or a respond.
3. **Wait for tool results.** After a tool_call, you will receive the tool's output as an observation. NEVER fabricate or assume tool results.
4. **Use respond when done.** When you have enough information to answer the user, use the "respond" action with your complete answer.
5. **Handle errors gracefully.** If a tool call fails, read the error message and try a different approach.
6. **Be concise and accurate.** Do not include unnecessary information in your responses. Do not apologize excessively.
7. **Output valid JSON only.** Your entire response must be a single valid JSON object matching the format above.`;
    }
}
