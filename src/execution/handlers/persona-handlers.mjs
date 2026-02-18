// Persona tool handlers
// Handles switch_persona, list_personas, get_active_persona, create_persona

/**
 * Register persona-related tool handlers.
 * @param {Map} handlers - The handler map from ToolExecutor
 * @param {Object} context - Shared context with personaManager, assistant, etc.
 */
export function registerPersonaHandlers(handlers, context) {
    const { personaManager, assistant } = context;

    handlers.set('switch_persona', async (args) => {
        if (!personaManager) {
            return 'Error: Persona system not initialized.';
        }

        const { persona_id } = args;
        const result = personaManager.switchPersona(persona_id);

        if (result.success) {
            // Trigger system prompt refresh so the new persona takes effect
            if (assistant && typeof assistant.markSystemPromptDirty === 'function') {
                assistant.markSystemPromptDirty();
                await assistant.updateSystemPrompt();
            }

            return JSON.stringify({
                status: 'switched',
                activePersona: {
                    id: result.persona.id,
                    name: result.persona.name,
                    description: result.persona.description
                },
                message: `Persona switched to "${result.persona.name}". System prompt has been updated. Your identity, mission, and behavioral directives are now active.`
            }, null, 2);
        } else {
            return `Error: ${result.error}`;
        }
    });

    handlers.set('list_personas', async () => {
        if (!personaManager) {
            return 'Error: Persona system not initialized.';
        }

        const personas = personaManager.listPersonas();

        if (personas.length === 0) {
            return JSON.stringify({
                message: 'No personas found. Create one with create_persona or add .json files to .ai-man/personas/',
                personas: []
            }, null, 2);
        }

        return JSON.stringify({
            count: personas.length,
            personas: personas.map(p => ({
                ...p,
                status: p.isActive ? '🟢 ACTIVE' : (p.isDefault ? '⭐ DEFAULT' : '⚪ available')
            }))
        }, null, 2);
    });

    handlers.set('get_active_persona', async () => {
        if (!personaManager) {
            return 'Error: Persona system not initialized.';
        }

        const persona = personaManager.getActivePersona();

        if (!persona) {
            return JSON.stringify({
                message: 'No active persona. Running in default mode without persona directives.',
                active: null
            }, null, 2);
        }

        return JSON.stringify({
            active: {
                id: persona.id,
                name: persona.name,
                description: persona.description,
                identity: persona.identity,
                mission: persona.mission,
                operationalBehavior: persona.operationalBehavior,
                communicationStyle: persona.communicationStyle,
                specialInstructions: persona.specialInstructions,
                bootstrap: persona.bootstrap
            }
        }, null, 2);
    });

    handlers.set('create_persona', async (args) => {
        if (!personaManager) {
            return 'Error: Persona system not initialized.';
        }

        const { id, name, description, core_directive, voice, missions, is_default } = args;

        // Build persona config from tool arguments
        const personaConfig = {
            id,
            name,
            description: description || `Custom persona: ${name}`,
            isDefault: !!is_default,
            version: '1.0.0',
            identity: {
                coreDirective: core_directive,
                voice: voice || 'professional and helpful',
                proactivityLevel: 'medium',
                relationship: ''
            },
            mission: (missions || []).map((m, i) => ({
                id: `mission-${i + 1}`,
                label: m.label || `Mission ${i + 1}`,
                description: m.description || '',
                priority: m.priority || i + 1,
                toolHints: []
            })),
            operationalBehavior: {
                loop: 'Listen -> Plan -> Execute -> Report',
                rules: []
            },
            toolGuidance: {},
            communicationStyle: {
                startConversations: false,
                checkInOnSilence: false,
                validateEarlyWork: false,
                examplePhrases: []
            },
            specialInstructions: [],
            bootstrap: {
                onFirstLoad: null,
                morningBriefing: { enabled: false }
            }
        };

        const result = await personaManager.createPersona(personaConfig);

        if (result.success) {
            return JSON.stringify({
                status: 'created',
                persona: {
                    id: result.persona.id,
                    name: result.persona.name,
                    description: result.persona.description
                },
                message: `Persona "${result.persona.name}" created. Use switch_persona to activate it.`
            }, null, 2);
        } else {
            return `Error: ${result.error}`;
        }
    });
}
