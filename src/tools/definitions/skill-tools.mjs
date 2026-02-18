export const SKILL_TOOLS = [
    {
        type: "function",
        function: {
            name: "list_skills",
            description: "List available skills loaded from the workspace.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_skill",
            description: "Read the instructions and documentation for a specific skill.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: {
                        type: "string",
                        description: "The name of the skill to read"
                    }
                },
                required: ["skill_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "use_skill",
            description: "Execute a task using a specific skill. The agent will load the skill documentation and use it to guide its actions. This effectively allows you to 'run' a skill.",
            parameters: {
                type: "object",
                properties: {
                    skill_name: {
                        type: "string",
                        description: "The name of the skill to use"
                    },
                    task: {
                        type: "string",
                        description: "The specific task to accomplish using this skill (e.g., 'Sign in to 1Password', 'Start a voice call')"
                    }
                },
                required: ["skill_name", "task"]
            }
        }
    }
];
