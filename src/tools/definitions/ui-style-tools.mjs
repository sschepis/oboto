// UI Style Tools — allow the AI to dynamically restyle the client UI
// These tools let the agent apply themes, override individual CSS tokens,
// inject custom CSS, and query the current style state.

export const UI_STYLE_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'set_ui_theme',
            description:
                'Apply a named theme preset to the client UI. ' +
                'Available presets: cyberpunk, ocean, sunset, matrix, midnight, arctic, ' +
                'forest, lavender, ember, monochrome. ' +
                'You may also supply "custom" with a full token map in `custom_tokens`.',
            parameters: {
                type: 'object',
                properties: {
                    theme: {
                        type: 'string',
                        description:
                            'Theme preset name (e.g. "cyberpunk", "midnight") or "custom" for a fully custom theme.'
                    },
                    custom_tokens: {
                        type: 'object',
                        description:
                            'When theme is "custom", provide a map of CSS variable names to values. ' +
                            'Keys should omit the leading "--". Example: { "color-primary": "#ff0080", "bg-main": "#0a0a0a" }',
                        additionalProperties: { type: 'string' }
                    }
                },
                required: ['theme']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_ui_tokens',
            description:
                'Override one or more individual CSS custom-property tokens on the client UI ' +
                'without changing the base theme. Useful for fine-tuning colors, fonts, spacing, ' +
                'border radii, etc. Tokens are applied as CSS variables on :root.',
            parameters: {
                type: 'object',
                properties: {
                    tokens: {
                        type: 'object',
                        description:
                            'Map of CSS variable names (without "--" prefix) to their new values. ' +
                            'Example: { "color-accent": "#00ff88", "font-mono": "\'Fira Code\', monospace", "radius-lg": "16px" }',
                        additionalProperties: { type: 'string' }
                    }
                },
                required: ['tokens']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'inject_ui_css',
            description:
                'Inject a block of arbitrary CSS into the client UI. ' +
                'The CSS is inserted into a dedicated <style id="ai-injected-css"> tag, ' +
                'replacing any previous injection. Use sparingly for effects ' +
                'that cannot be achieved with token overrides alone.',
            parameters: {
                type: 'object',
                properties: {
                    css: {
                        type: 'string',
                        description: 'Raw CSS string to inject. Scoped to the entire document.'
                    },
                    mode: {
                        type: 'string',
                        enum: ['replace', 'append'],
                        description:
                            '"replace" clears previous injections, "append" adds to them. Default: "replace".'
                    }
                },
                required: ['css']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'reset_ui_style',
            description:
                'Reset the client UI styling back to the system default, clearing ' +
                'all custom tokens, injected CSS, and reverting to the default theme.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_ui_style_state',
            description:
                'Query the current UI style state including the active theme name, ' +
                'any custom token overrides, and whether custom CSS has been injected.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_display_names',
            description:
                'Set the display names shown in the chat UI for the user and/or the AI agent. ' +
                'Call this when you learn the user\'s name (e.g. they introduce themselves) ' +
                'or when you adopt/change your own name. The chat will show these names ' +
                'instead of the default "You" and "Nexus" labels.',
            parameters: {
                type: 'object',
                properties: {
                    user_name: {
                        type: 'string',
                        description:
                            'The user\'s name to display on their chat messages. ' +
                            'Omit to leave unchanged.'
                    },
                    agent_name: {
                        type: 'string',
                        description:
                            'The AI agent\'s name to display on its chat messages. ' +
                            'Omit to leave unchanged.'
                    }
                },
                required: []
            }
        }
    }
];
