export const PERSONA_TOOLS = [
    {
        type: "function",
        function: {
            name: "switch_persona",
            description: "Switch the AI's active persona. This changes the identity, voice, mission priorities, and behavioral directives. The system prompt will be updated to reflect the new persona.",
            parameters: {
                type: "object",
                properties: {
                    persona_id: {
                        type: "string",
                        description: "The ID of the persona to switch to (e.g., 'the-architect', 'default')"
                    }
                },
                required: ["persona_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_personas",
            description: "List all available AI personas with their names, descriptions, and active/default status.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_active_persona",
            description: "Get the full configuration of the currently active persona, including identity, mission, behavioral directives, and special instructions.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_persona",
            description: "Create a new persona configuration. Provide a full persona definition with identity, mission, and behavioral directives.",
            parameters: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: "Unique identifier for the persona (kebab-case, e.g., 'my-persona')"
                    },
                    name: {
                        type: "string",
                        description: "Display name for the persona"
                    },
                    description: {
                        type: "string",
                        description: "Brief description of the persona's purpose"
                    },
                    core_directive: {
                        type: "string",
                        description: "The core identity statement (who the AI is under this persona)"
                    },
                    voice: {
                        type: "string",
                        description: "Communication style description (e.g., 'professional, concise')"
                    },
                    missions: {
                        type: "array",
                        description: "Array of mission objects with label, description, and priority",
                        items: {
                            type: "object",
                            properties: {
                                label: { type: "string" },
                                description: { type: "string" },
                                priority: { type: "number" }
                            }
                        }
                    },
                    is_default: {
                        type: "boolean",
                        description: "Whether this should be the default persona"
                    }
                },
                required: ["id", "name", "core_directive"]
            }
        }
    }
];
