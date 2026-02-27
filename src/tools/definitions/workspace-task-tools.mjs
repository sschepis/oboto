export const WORKSPACE_TASK_TOOLS = [
    {
        type: "function",
        function: {
            name: "spawn_workspace_task",
            description: "Spawn a background AI task that runs in a DIFFERENT workspace directory. The task gets full isolation — its own conversation history, tools, plugins, and MCP servers. Results are reported back to this conversation when complete. Use this to work on multiple projects in parallel.",
            parameters: {
                type: "object",
                properties: {
                    workspace_path: {
                        type: "string",
                        description: "Absolute or relative path to the target workspace directory. Will be created if it does not exist."
                    },
                    task_description: {
                        type: "string",
                        description: "Brief human-readable description of the task"
                    },
                    query: {
                        type: "string",
                        description: "The detailed prompt/instructions for the workspace task"
                    },
                    context: {
                        type: "string",
                        description: "Additional context from the current conversation to pass to the workspace task"
                    },
                    init_git: {
                        type: "boolean",
                        description: "If creating a new directory, initialize a git repository. Default: false"
                    }
                },
                required: ["workspace_path", "task_description", "query"]
            }
        }
    }
];
