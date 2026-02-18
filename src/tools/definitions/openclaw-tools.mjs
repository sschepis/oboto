export const OPENCLAW_TOOLS = [
    {
        type: "function",
        function: {
            name: "delegate_to_openclaw",
            description: "Delegate a task or send a message to the OpenClaw AI assistant. Use this when the user explicitly asks to interact with OpenClaw (e.g., @openclaw messages), or when delegating tasks that OpenClaw is better suited for such as multi-channel messaging, browser automation, or long-running background operations.",
            parameters: {
                type: "object",
                properties: {
                    message: {
                        type: "string",
                        description: "The message or task to send to OpenClaw"
                    },
                    sessionKey: {
                        type: "string",
                        description: "Optional session key to target a specific OpenClaw session"
                    },
                    thinking: {
                        type: "string",
                        enum: ["off", "minimal", "low", "medium", "high"],
                        description: "Thinking level for the OpenClaw agent"
                    }
                },
                required: ["message"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "openclaw_status",
            description: "Check the connection status and health of the OpenClaw integration.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "openclaw_sessions",
            description: "List active sessions on the connected OpenClaw instance.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    }
];
