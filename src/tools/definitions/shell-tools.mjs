export const SHELL_TOOLS = [{
    type: "function",
    function: {
        name: "run_command",
        description: "Execute a shell command in the workspace. Use for: running tests, git operations, build commands, etc.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The shell command to execute" },
                cwd: { type: "string", description: "Working directory (default: workspace root)" },
                timeout: { type: "number", description: "Timeout in ms (default: 30000)" }
            },
            required: ["command"]
        }
    }
}];
