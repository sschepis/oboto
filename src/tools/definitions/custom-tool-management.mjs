export const CUSTOM_TOOL_MANAGEMENT = [
    {
        type: "function",
        function: {
            name: "list_custom_tools",
            description: "List all custom tools that have been created and saved, with optional filtering by category",
            parameters: {
                type: "object",
                properties: {
                    category: {
                        type: "string",
                        description: "Filter tools by category (optional)"
                    },
                    show_usage: {
                        type: "boolean",
                        description: "Include usage statistics in the output",
                        default: false
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "remove_custom_tool",
            description: "Remove a custom tool from the toolbox permanently",
            parameters: {
                type: "object",
                properties: {
                    tool_name: {
                        type: "string",
                        description: "Name of the tool to remove"
                    }
                },
                required: ["tool_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "export_tools",
            description: "Export custom tools to a shareable JSON file",
            parameters: {
                type: "object",
                properties: {
                    output_file: {
                        type: "string",
                        description: "Path where to save the exported tools file"
                    },
                    tools: {
                        type: "array",
                        description: "Specific tools to export (exports all if not specified)",
                        items: { type: "string" }
                    }
                }
            }
        }
    }
];

export const WORKSPACE_TOOLS = [
    {
        type: "function",
        function: {
            name: "manage_workspace",
            description: "Create, update, or clear persistent workspace data for complex multi-step tasks. Use this to maintain context across retries and quality evaluations.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "update", "clear", "show"],
                        description: "Action to perform: create new workspace, update existing, clear workspace, or show current workspace"
                    },
                    task_goal: {
                        type: "string",
                        description: "The main goal/objective of the current task (required for 'create')"
                    },
                    current_step: {
                        type: "string",
                        description: "Description of the current step being worked on"
                    },
                    progress_data: {
                        type: "object",
                        description: "Data collected so far (files found, analysis results, etc.)"
                    },
                    next_steps: {
                        type: "array",
                        description: "Planned next steps",
                        items: { type: "string" }
                    },
                    status: {
                        type: "string",
                        enum: ["in_progress", "completed", "failed"],
                        description: "Current status of the task"
                    }
                },
                required: ["action"]
            }
        }
    }
];
