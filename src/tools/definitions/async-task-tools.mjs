export const ASYNC_TASK_TOOLS = [
    {
        type: "function",
        function: {
            name: "spawn_background_task",
            description: "Spawns a background AI task that runs asynchronously. Returns immediately with a task ID. Use check_task_status or list_background_tasks to monitor progress. The task runs independently and will complete in the background.",
            parameters: {
                type: "object",
                properties: {
                    task_description: {
                        type: "string",
                        description: "Brief human-readable description of the task"
                    },
                    query: {
                        type: "string", 
                        description: "The detailed prompt/instructions for the background task"
                    },
                    context: {
                        type: "string",
                        description: "Additional context from the current conversation"
                    }
                },
                required: ["task_description", "query"]
            }
        }
    },
    {
        type: "function", 
        function: {
            name: "check_task_status",
            description: "Check the status and result of a background task by its ID.",
            parameters: {
                type: "object",
                properties: {
                    task_id: {
                        type: "string",
                        description: "The task ID returned by spawn_background_task"
                    }
                },
                required: ["task_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_background_tasks",
            description: "List all background tasks and their current status.",
            parameters: {
                type: "object",
                properties: {
                    status_filter: {
                        type: "string",
                        enum: ["all", "running", "completed", "failed", "cancelled", "queued"],
                        description: "Filter tasks by status. Default: all"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "cancel_background_task",
            description: "Cancel a running or queued background task.",
            parameters: {
                type: "object",
                properties: {
                    task_id: {
                        type: "string",
                        description: "The task ID to cancel"
                    }
                },
                required: ["task_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_task_output",
            description: "Get the real-time output log of a background task.",
            parameters: {
                type: "object",
                properties: {
                    task_id: {
                        type: "string",
                        description: "The task ID"
                    },
                    last_n_lines: {
                        type: "number",
                        description: "Number of recent lines to retrieve (default: 20)"
                    }
                },
                required: ["task_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "wait_for_task",
            description: "Block and wait for a specific background task to complete. Returns the result.",
            parameters: {
                type: "object",
                properties: {
                    task_id: {
                        type: "string",
                        description: "The task ID to wait for"
                    },
                    timeout_seconds: {
                        type: "number",
                        description: "Maximum seconds to wait. Default: 300 (5 minutes)"
                    }
                },
                required: ["task_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_recurring_task",
            description: "Create a task that runs on a recurring schedule.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Short name for the recurring task"
                    },
                    description: {
                        type: "string",
                        description: "Description of what the task does"
                    },
                    query: {
                        type: "string",
                        description: "The prompt/instructions to execute"
                    },
                    interval_minutes: {
                        type: "number",
                        description: "Run every N minutes"
                    },
                    max_runs: {
                        type: "number",
                        description: "Optional limit on number of runs"
                    },
                    skip_if_running: {
                        type: "boolean",
                        description: "Skip scheduled run if previous instance is still running (default: true)"
                    }
                },
                required: ["name", "description", "query", "interval_minutes"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_recurring_tasks",
            description: "List all recurring task schedules.",
            parameters: {
                type: "object",
                properties: {
                    status_filter: {
                        type: "string",
                        enum: ["all", "active", "paused"],
                        description: "Filter by status"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "manage_recurring_task",
            description: "Pause, resume, delete, or trigger a recurring task schedule.",
            parameters: {
                type: "object",
                properties: {
                    schedule_id: {
                        type: "string",
                        description: "The schedule ID"
                    },
                    action: {
                        type: "string",
                        enum: ["pause", "resume", "delete", "trigger_now"],
                        description: "Action to perform"
                    }
                },
                required: ["schedule_id", "action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "ask_blocking_question",
            description: "Ask the user a BLOCKING question that will appear in their main chat conversation. This pauses the background agent loop until the user responds. ONLY use this when you absolutely cannot proceed without the user's input. The loop will NOT continue until the user answers.",
            parameters: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "The question to ask the user. Be specific and explain why you need this information to proceed."
                    }
                },
                required: ["question"]
            }
        }
    }
];
