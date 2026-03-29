/**
 * Tool definitions for the Workspace Secrets Management system.
 * 
 * The `request_secret` tool allows the AI agent to request secrets (API keys,
 * tokens, etc.) from the user via a secure UI input. The secret value is
 * written directly to the workspace `.env` file and encrypted vault — it
 * NEVER appears in the AI's context or conversation history.
 */

export const SECRET_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'request_secret',
            description:
                'Request the user to provide a secret value such as an API key, token, or password. ' +
                'This displays a secure input form in the user\'s chat. The secret value is stored ' +
                'directly in the workspace .env file and is NEVER visible to you. Use this when you ' +
                'need an API key or credential to proceed with a task.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description:
                            'The environment variable name for the secret, e.g. OPENAI_API_KEY, STRIPE_SECRET_KEY'
                    },
                    label: {
                        type: 'string',
                        description:
                            'A human-readable label shown to the user, e.g. "OpenAI API Key"'
                    },
                    description: {
                        type: 'string',
                        description:
                            'Optional explanation of why this secret is needed and where to obtain it'
                    }
                },
                required: ['name', 'label']
            }
        }
    }
];
