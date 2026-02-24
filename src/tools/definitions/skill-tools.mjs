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
    },
    {
        type: "function",
        function: {
            name: "add_npm_skill",
            description: "Add one or more npm packages as skills to the workspace. This will install the packages and make their documentation available as skills.",
            parameters: {
                type: "object",
                properties: {
                    packages: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of npm package names to add as skills"
                    }
                },
                required: ["packages"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_skill",
            description: "Create a new skill by writing a SKILL.md file. Skills contain domain-specific instructions, strategies, and tool-usage guides that teach the agent how to handle specialized tasks. Use this to extend your own capabilities by codifying knowledge for future reuse.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Skill name (alphanumeric, hyphens, underscores). Used as the directory name."
                    },
                    content: {
                        type: "string",
                        description: "Full SKILL.md content. May include YAML frontmatter (---\\nname: ...\\n---) followed by markdown instructions. If frontmatter is omitted, it will be auto-generated."
                    },
                    scope: {
                        type: "string",
                        enum: ["workspace", "global"],
                        description: "Where to create the skill. 'workspace' stores in .skills/ (project-specific), 'global' stores in the application skills/ dir (shared across workspaces). Default: workspace."
                    }
                },
                required: ["name", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "edit_skill",
            description: "Edit an existing skill's content by replacing its SKILL.md file. Use this to update, improve, or extend skill instructions. Cannot edit npm-sourced skills.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Name of the skill to edit (must already exist)"
                    },
                    content: {
                        type: "string",
                        description: "New full SKILL.md content to replace the existing content"
                    }
                },
                required: ["name", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_skill",
            description: "Delete an existing skill by name. Removes the skill directory and its SKILL.md file. Cannot delete npm-sourced skills.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Name of the skill to delete"
                    }
                },
                required: ["name"]
            }
        }
    }
];
