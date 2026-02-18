export const RECURSIVE_TOOLS = [
    {
        type: "function",
        function: {
            name: "call_ai_assistant",
            description: "Recursively calls the AI assistant to handle a sub-task or specialized query. Useful for breaking down complex problems or getting specialized analysis. Maximum recursion depth is 3 levels.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The specific query or task to send to the recursive AI assistant"
                    },
                    context: {
                        type: "string",
                        description: "Additional context about why this recursive call is needed and how it relates to the main task"
                    },
                    recursion_level: {
                        type: "number",
                        description: "Current recursion level (automatically managed, do not set manually)",
                        default: 0
                    }
                },
                required: ["query", "context"]
            }
        }
    }
];
