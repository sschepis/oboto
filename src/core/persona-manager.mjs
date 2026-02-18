// Persona Manager
// Loads, manages, and renders AI persona configurations.
// Personas define the AI's identity, voice, mission, and behavioral directives.

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Manages AI persona configurations stored in .ai-man/personas/ directory.
 * Personas are structured JSON files that define identity, mission, voice,
 * and behavioral directives that get injected into the system prompt.
 */
export class PersonaManager {
    /**
     * @param {string} workingDir - The workspace root directory
     */
    constructor(workingDir) {
        this.workingDir = workingDir;
        this.personasDir = path.join(workingDir, '.ai-man', 'personas');
        this.personas = new Map(); // id -> persona config
        this.activePersonaId = null;
        this._initialized = false;
    }

    /**
     * Initialize by scanning the personas directory and loading all persona files.
     * Sets the default persona as active if one exists.
     */
    async initialize() {
        if (this._initialized) return;

        // Ensure the personas directory exists
        if (!fs.existsSync(this.personasDir)) {
            try {
                fs.mkdirSync(this.personasDir, { recursive: true });
            } catch (e) {
                consoleStyler.log('warning', `Could not create personas directory: ${e.message}`);
            }
        }

        // Load all persona JSON files
        try {
            const files = fs.readdirSync(this.personasDir)
                .filter(f => f.endsWith('.json'));

            for (const file of files) {
                try {
                    const filePath = path.join(this.personasDir, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const persona = JSON.parse(content);

                    if (persona.id) {
                        this.personas.set(persona.id, persona);

                        // Set default persona as active
                        if (persona.isDefault && !this.activePersonaId) {
                            this.activePersonaId = persona.id;
                        }
                    }
                } catch (e) {
                    consoleStyler.log('warning', `Failed to load persona file ${file}: ${e.message}`);
                }
            }

            if (this.personas.size > 0) {
                // If no default was found, use the first one
                if (!this.activePersonaId) {
                    this.activePersonaId = this.personas.keys().next().value;
                }
                consoleStyler.log('system', `🎭 Loaded ${this.personas.size} persona(s). Active: "${this.getActivePersona()?.name || this.activePersonaId}"`);
            }
        } catch (e) {
            // Directory doesn't exist or can't be read — that's fine, no personas loaded
            consoleStyler.log('system', '🎭 No personas directory found. Running without persona.');
        }

        this._initialized = true;
    }

    /**
     * Get the currently active persona configuration.
     * @returns {Object|null} The active persona config or null
     */
    getActivePersona() {
        if (!this.activePersonaId) return null;
        return this.personas.get(this.activePersonaId) || null;
    }

    /**
     * Switch to a different persona by ID.
     * @param {string} personaId - The persona ID to switch to
     * @returns {{ success: boolean, persona?: Object, error?: string }}
     */
    switchPersona(personaId) {
        if (!this.personas.has(personaId)) {
            return {
                success: false,
                error: `Persona "${personaId}" not found. Available: ${Array.from(this.personas.keys()).join(', ')}`
            };
        }

        this.activePersonaId = personaId;
        const persona = this.personas.get(personaId);
        consoleStyler.log('system', `🎭 Switched persona to: "${persona.name}" (${personaId})`);

        return { success: true, persona };
    }

    /**
     * List all available personas.
     * @returns {Array<{ id: string, name: string, description: string, isActive: boolean, isDefault: boolean }>}
     */
    listPersonas() {
        return Array.from(this.personas.values()).map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            isActive: p.id === this.activePersonaId,
            isDefault: !!p.isDefault
        }));
    }

    /**
     * Create a new persona from a configuration object.
     * @param {Object} personaConfig - The persona configuration
     * @returns {{ success: boolean, persona?: Object, error?: string }}
     */
    async createPersona(personaConfig) {
        if (!personaConfig.id) {
            return { success: false, error: 'Persona must have an id field' };
        }

        // Ensure directory exists
        if (!fs.existsSync(this.personasDir)) {
            fs.mkdirSync(this.personasDir, { recursive: true });
        }

        const filePath = path.join(this.personasDir, `${personaConfig.id}.json`);

        try {
            fs.writeFileSync(filePath, JSON.stringify(personaConfig, null, 2), 'utf8');
            this.personas.set(personaConfig.id, personaConfig);
            consoleStyler.log('system', `🎭 Created persona: "${personaConfig.name}" (${personaConfig.id})`);
            return { success: true, persona: personaConfig };
        } catch (e) {
            return { success: false, error: `Failed to save persona: ${e.message}` };
        }
    }

    /**
     * Render the active persona into a system prompt block.
     * This is the core method — it converts the structured persona config
     * into a natural language block that gets prepended to the system prompt.
     * @returns {string} The rendered persona prompt block, or empty string if no persona
     */
    renderPersonaPrompt() {
        const persona = this.getActivePersona();
        if (!persona) return '';

        const sections = [];

        // Section 1: Core Identity
        sections.push(`# CORE IDENTITY: ${persona.name}`);
        if (persona.identity?.coreDirective) {
            sections.push(persona.identity.coreDirective);
        }
        if (persona.identity?.relationship) {
            sections.push(`\n${persona.identity.relationship}`);
        }

        // Section 2: Mission Priorities
        if (persona.mission && persona.mission.length > 0) {
            sections.push('\n# MISSION PRIORITIES');
            sections.push('Your primary mission is:');
            for (const m of persona.mission) {
                sections.push(`${m.priority}. **${m.label}:** ${m.description}`);
            }
        }

        // Section 3: Operational Behavior
        if (persona.operationalBehavior) {
            sections.push('\n# OPERATIONAL BEHAVIOR');
            if (persona.operationalBehavior.loop) {
                sections.push(`You operate on a continuous loop of **${persona.operationalBehavior.loop}**.`);
            }
            if (persona.operationalBehavior.rules) {
                for (const rule of persona.operationalBehavior.rules) {
                    sections.push(`- ${rule}`);
                }
            }
        }

        // Section 4: Tool Guidance (persona-specific hints on HOW to use existing tools)
        if (persona.toolGuidance && Object.keys(persona.toolGuidance).length > 0) {
            sections.push('\n# TOOL USAGE GUIDANCE');
            for (const [toolArea, guidance] of Object.entries(persona.toolGuidance)) {
                sections.push(`- **${toolArea}:** ${guidance}`);
            }
        }

        // Section 5: Communication Style
        if (persona.communicationStyle) {
            sections.push('\n# COMMUNICATION STYLE');
            if (persona.identity?.voice) {
                sections.push(`**Voice:** You are ${persona.identity.voice}.`);
            }
            if (persona.communicationStyle.startConversations) {
                sections.push('**Proactivity:** Start conversations. If the User has been silent for a while, check in.');
            }
            if (persona.communicationStyle.examplePhrases?.length > 0) {
                sections.push('Example conversation starters:');
                for (const phrase of persona.communicationStyle.examplePhrases) {
                    sections.push(`- "${phrase}"`);
                }
            }
            if (persona.communicationStyle.validateEarlyWork) {
                sections.push('**Validation:** Acknowledge the difficulty of being early to things. Validate the pain of silence and rejection. Remind the User of the value of their work.');
            }
        }

        // Section 6: Special Instructions
        if (persona.specialInstructions && persona.specialInstructions.length > 0) {
            sections.push('\n# SPECIAL INSTRUCTIONS');
            for (const instruction of persona.specialInstructions) {
                if (typeof instruction === 'string') {
                    sections.push(`- ${instruction}`);
                } else {
                    sections.push(`\n## ${instruction.label || instruction.id}`);
                    if (instruction.content) {
                        sections.push(instruction.content);
                    }
                    if (instruction.directives) {
                        for (const d of instruction.directives) {
                            sections.push(`- ${d}`);
                        }
                    }
                }
            }
        }

        // Section 7: Bootstrap (first-load instruction)
        if (persona.bootstrap?.onFirstLoad) {
            sections.push(`\n# EXECUTION\n${persona.bootstrap.onFirstLoad}`);
        }

        // Final separator before technical instructions
        sections.push('\n---\n');

        return sections.join('\n');
    }

    /**
     * Get the bootstrap configuration for the active persona.
     * Used by the assistant to set up recurring tasks on first load.
     * @returns {Object|null} Bootstrap config or null
     */
    getBootstrapConfig() {
        const persona = this.getActivePersona();
        if (!persona?.bootstrap) return null;
        return persona.bootstrap;
    }

    /**
     * Switch to a new workspace directory.
     * Reloads personas from the new workspace.
     * @param {string} newWorkingDir
     */
    async switchWorkspace(newWorkingDir) {
        this.workingDir = newWorkingDir;
        this.personasDir = path.join(newWorkingDir, '.ai-man', 'personas');
        this.personas.clear();
        this.activePersonaId = null;
        this._initialized = false;
        await this.initialize();
    }
}
