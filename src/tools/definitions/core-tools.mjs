export const CORE_TOOLS = [
    {
        type: "function",
        function: {
            name: "execute_javascript",
            description: "Executes a string of JavaScript code using eval(). Use this for simple calculations or for writing complex scripts that compose multiple functions or packages. You can specify dependent npm packages that must be installed. Optionally save useful code as a reusable tool.",
            parameters: {
                type: "object",
                properties: {
                    code: {
                        type: "string",
                        description: "The JavaScript code to execute. Must be an async IIFE (Immediately Invoked Function Expression) if it uses imports, e.g., (async () => { const axios = await import('axios'); /* ... */ })();",
                    },
                    npm_packages: {
                        type: "array",
                        description: "An optional array of npm package names that need to be installed before the script is run (e.g., ['axios', 'chalk']).",
                        items: {
                            type: "string"
                        }
                    },
                    save_as_tool: {
                        type: "boolean",
                        description: "Whether to save this code as a reusable tool for future use.",
                        default: false
                    },
                    tool_name: {
                        type: "string",
                        description: "Name for the tool (snake_case, e.g. 'get_weather'). Required if save_as_tool is true."
                    },
                    tool_description: {
                        type: "string",
                        description: "Description of what this tool does. Required if save_as_tool is true."
                    },
                    tool_category: {
                        type: "string",
                        description: "Category for the tool (e.g. 'file', 'web', 'data', 'utility'). Optional.",
                        default: "utility"
                    }
                },
                required: ["code"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "execute_npm_function",
            description: "Dynamically installs an npm package if needed, imports it, and executes a specific function from it with given arguments. Use this for single, specific package functions.",
            parameters: {
                type: "object",
                properties: {
                    packageName: {
                        type: "string",
                        description: "The name of the npm package to use (e.g., 'axios', 'uuid').",
                    },
                    functionName: {
                        type: "string",
                        description: "The name of the function to call from the package (e.g., 'get', 'v4'). If the package itself is a function, use 'default'.",
                    },
                    args: {
                        type: "array",
                        description: "An array of arguments to pass to the function.",
                        items: {
                            type: "any"
                        }
                    }
                },
                required: ["packageName", "functionName", "args"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_conversation_history",
            description: "Reads the full conversation history (excluding the current turn) to retrieve context that may have been optimized out of the active context window. Use this when you need to recall details from earlier in the session.",
            parameters: {
                type: "object",
                properties: {
                    limit: {
                        type: "number",
                        description: "Number of most recent messages to retrieve (default: 50). Use -1 for all.",
                        default: 50
                    },
                    offset: {
                        type: "number",
                        description: "Number of most recent messages to skip (default: 0).",
                        default: 0
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "promote_memory",
            description: "Promotes a piece of information, code pattern, or lesson learned to the Global Holographic Memory. This memory will be accessible across ALL projects. Use this for highly reusable insights.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "The content of the memory to store."
                    },
                    category: {
                        type: "string",
                        description: "Optional category (e.g., 'code-pattern', 'bug-fix', 'architecture', 'preference').",
                        default: "general"
                    },
                    importance: {
                        type: "number",
                        description: "Importance score (1-10).",
                        default: 5
                    }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_global_memory",
            description: "Searches the Global Holographic Memory for insights, patterns, or solutions stored from previous projects or sessions.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query keywords."
                    },
                    limit: {
                        type: "number",
                        description: "Max number of results to return.",
                        default: 5
                    }
                },
                required: ["query"]
            }
        }
    }
];
