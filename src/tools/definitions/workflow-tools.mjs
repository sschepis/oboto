export const WORKFLOW_TOOLS = [
    {
        type: "function",
        function: {
            name: "create_todo_list",
            description: "Creates a todo list for complex tasks that need to be broken down into steps. Use this when a user request requires multiple sequential actions.",
            parameters: {
                type: "object",
                properties: {
                    task_description: {
                        type: "string",
                        description: "Brief description of the overall task."
                    },
                    todos: {
                        type: "array",
                        description: "Array of todo items in execution order.",
                        items: {
                            type: "object",
                            properties: {
                                step: {
                                    type: "string",
                                    description: "Description of this step."
                                },
                                status: {
                                    type: "string",
                                    enum: ["pending", "in_progress", "completed"],
                                    description: "Status of this step."
                                }
                            },
                            required: ["step", "status"]
                        }
                    }
                },
                required: ["task_description", "todos"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "update_todo_status",
            description: "Updates the status of a todo item and moves to the next step if completed.",
            parameters: {
                type: "object",
                properties: {
                    step_index: {
                        type: "number",
                        description: "Zero-based index of the step to update."
                    },
                    status: {
                        type: "string",
                        enum: ["pending", "in_progress", "completed"],
                        description: "New status for this step."
                    },
                    result: {
                        type: "string",
                        description: "Brief result or outcome of completing this step."
                    }
                },
                required: ["step_index", "status"],
            },
        },
    }
];

export const RECOVERY_TOOLS = [
    {
        type: "function",
        function: {
            name: "analyze_and_recover",
            description: "Analyzes the last error and attempts recovery with alternative approaches.",
            parameters: {
                type: "object",
                properties: {
                    error_message: {
                        type: "string",
                        description: "The error message to analyze."
                    },
                    failed_approach: {
                        type: "string",
                        description: "Description of what was attempted that failed."
                    },
                    recovery_strategy: {
                        type: "string",
                        enum: ["retry_with_alternative", "simplify_approach", "change_method", "install_dependencies", "fix_syntax"],
                        description: "The recovery strategy to attempt."
                    },
                    alternative_code: {
                        type: "string",
                        description: "Alternative code to try if using retry_with_alternative strategy.",
                        required: false
                    }
                },
                required: ["error_message", "failed_approach", "recovery_strategy"],
            },
        },
    }
];
