/**
 * Oboto Personas Plugin
 *
 * Manages AI persona configurations — creation, switching, listing, and
 * system prompt injection via renderPersonaPrompt().
 *
 * Extracted from:
 *   - src/core/persona-manager.mjs
 *   - src/execution/handlers/persona-handlers.mjs
 *   - src/tools/definitions/persona-tools.mjs
 *
 * @module @oboto/plugin-personas
 */

import { PersonaManager } from './persona-manager.mjs';

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const { settings } = api;

    // Determine workspace root — prefer api.services if available
    const workingDir = api.services?.workingDir ?? process.cwd();

    const personaManager = new PersonaManager(workingDir);
    await personaManager.initialize();

    // If a default persona ID is stored in settings, activate it
    const defaultId = await settings.get('defaultPersonaId');
    if (defaultId && personaManager.personas.has(defaultId)) {
        personaManager.switchPersona(defaultId);
    }

    // ── Register tools ───────────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'switch_persona',
        description: "Switch the AI's active persona. This changes the identity, voice, mission priorities, and behavioral directives. The system prompt will be updated to reflect the new persona.",
        parameters: {
            type: 'object',
            properties: {
                persona_id: {
                    type: 'string',
                    description: "The ID of the persona to switch to (e.g., 'the-architect', 'default')",
                },
            },
            required: ['persona_id'],
        },
        handler: async (args) => {
            const { persona_id } = args;
            const result = personaManager.switchPersona(persona_id);

            if (result.success) {
                // Trigger system prompt refresh if the assistant exposes the method
                const assistant = api.services?.assistant;
                if (assistant && typeof assistant.markSystemPromptDirty === 'function') {
                    assistant.markSystemPromptDirty();
                    await assistant.updateSystemPrompt();
                }

                return JSON.stringify({
                    status: 'switched',
                    activePersona: {
                        id: result.persona.id,
                        name: result.persona.name,
                        description: result.persona.description,
                    },
                    message: `Persona switched to "${result.persona.name}". System prompt has been updated.`,
                }, null, 2);
            }

            return `Error: ${result.error}`;
        },
    });

    api.tools.register({
        useOriginalName: true,
        name: 'list_personas',
        description: 'List all available AI personas with their names, descriptions, and active/default status.',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
            const personas = personaManager.listPersonas();
            if (personas.length === 0) {
                return JSON.stringify({
                    message: 'No personas found. Create one with create_persona or add .json files to .oboto/personas/',
                    personas: [],
                }, null, 2);
            }

            return JSON.stringify({
                count: personas.length,
                personas: personas.map(p => ({
                    ...p,
                    status: p.isActive ? '🟢 ACTIVE' : (p.isDefault ? '⭐ DEFAULT' : '⚪ available'),
                })),
            }, null, 2);
        },
    });

    api.tools.register({
        useOriginalName: true,
        name: 'get_active_persona',
        description: 'Get the full configuration of the currently active persona, including identity, mission, behavioral directives, and special instructions.',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
            const persona = personaManager.getActivePersona();
            if (!persona) {
                return JSON.stringify({
                    message: 'No active persona. Running in default mode without persona directives.',
                    active: null,
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
                    bootstrap: persona.bootstrap,
                },
            }, null, 2);
        },
    });

    api.tools.register({
        useOriginalName: true,
        name: 'create_persona',
        description: 'Create a new persona configuration. Provide a full persona definition with identity, mission, and behavioral directives.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: "Unique identifier for the persona (kebab-case, e.g., 'my-persona')" },
                name: { type: 'string', description: 'Display name for the persona' },
                description: { type: 'string', description: "Brief description of the persona's purpose" },
                core_directive: { type: 'string', description: 'The core identity statement (who the AI is under this persona)' },
                voice: { type: 'string', description: "Communication style description (e.g., 'professional, concise')" },
                missions: {
                    type: 'array',
                    description: 'Array of mission objects with label, description, and priority',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string' },
                            description: { type: 'string' },
                            priority: { type: 'number' },
                        },
                    },
                },
                is_default: { type: 'boolean', description: 'Whether this should be the default persona' },
            },
            required: ['id', 'name', 'core_directive'],
        },
        handler: async (args) => {
            const { id, name, description, core_directive, voice, missions, is_default } = args;

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
                    relationship: '',
                },
                mission: (missions || []).map((m, i) => ({
                    id: `mission-${i + 1}`,
                    label: m.label || `Mission ${i + 1}`,
                    description: m.description || '',
                    priority: m.priority || i + 1,
                    toolHints: [],
                })),
                operationalBehavior: {
                    loop: 'Listen -> Plan -> Execute -> Report',
                    rules: [],
                },
                toolGuidance: {},
                communicationStyle: {
                    startConversations: false,
                    checkInOnSilence: false,
                    validateEarlyWork: false,
                    examplePhrases: [],
                },
                specialInstructions: [],
                bootstrap: {
                    onFirstLoad: null,
                    morningBriefing: { enabled: false },
                },
            };

            const result = await personaManager.createPersona(personaConfig);

            if (result.success) {
                return JSON.stringify({
                    status: 'created',
                    persona: {
                        id: result.persona.id,
                        name: result.persona.name,
                        description: result.persona.description,
                    },
                    message: `Persona "${result.persona.name}" created. Use switch_persona to activate it.`,
                }, null, 2);
            }

            return `Error: ${result.error}`;
        },
    });
}

export async function deactivate(_api) {
    // Cleanup handled automatically by PluginAPI._cleanup()
}
