/**
 * PersonaManager — manages AI persona configurations.
 *
 * Ported from src/core/persona-manager.mjs.
 * Personas are structured JSON files stored in ~/.oboto/personas/ (or a
 * workspace-local .oboto/personas/ directory) that define identity, mission,
 * voice, and behavioral directives injected into the system prompt.
 *
 * @module @oboto/plugin-personas/persona-manager
 */

import fs from 'fs';
import path from 'path';

export class PersonaManager {
    /**
     * @param {string} workingDir — workspace root directory
     */
    constructor(workingDir) {
        this.workingDir = workingDir;
        this.personasDir = path.join(workingDir, '.oboto', 'personas');
        this.personas = new Map(); // id → persona config
        this.activePersonaId = null;
        this._initialized = false;
    }

    /* ------------------------------------------------------------------ */
    /*  Initialization                                                     */
    /* ------------------------------------------------------------------ */

    async initialize() {
        if (this._initialized) return;

        // Ensure personas directory exists
        if (!fs.existsSync(this.personasDir)) {
            try {
                fs.mkdirSync(this.personasDir, { recursive: true });
            } catch {
                // Non-fatal — directory may be read-only
            }
        }

        // Load all persona JSON files
        try {
            const files = fs.readdirSync(this.personasDir).filter(f => f.endsWith('.json'));

            for (const file of files) {
                try {
                    const filePath = path.join(this.personasDir, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const persona = JSON.parse(content);

                    if (persona.id) {
                        this.personas.set(persona.id, persona);

                        if (persona.isDefault && !this.activePersonaId) {
                            this.activePersonaId = persona.id;
                        }
                    }
                } catch {
                    // Skip malformed persona files
                }
            }

            // Fallback: use first persona if no default was flagged
            if (this.personas.size > 0 && !this.activePersonaId) {
                this.activePersonaId = this.personas.keys().next().value;
            }
        } catch {
            // Directory doesn't exist or can't be read — no personas loaded
        }

        this._initialized = true;
    }

    /* ------------------------------------------------------------------ */
    /*  Accessors                                                          */
    /* ------------------------------------------------------------------ */

    getActivePersona() {
        if (!this.activePersonaId) return null;
        return this.personas.get(this.activePersonaId) || null;
    }

    switchPersona(personaId) {
        if (!this.personas.has(personaId)) {
            return {
                success: false,
                error: `Persona "${personaId}" not found. Available: ${Array.from(this.personas.keys()).join(', ')}`,
            };
        }

        this.activePersonaId = personaId;
        const persona = this.personas.get(personaId);
        return { success: true, persona };
    }

    listPersonas() {
        return Array.from(this.personas.values()).map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            isActive: p.id === this.activePersonaId,
            isDefault: !!p.isDefault,
        }));
    }

    /* ------------------------------------------------------------------ */
    /*  Create persona                                                     */
    /* ------------------------------------------------------------------ */

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
            return { success: true, persona: personaConfig };
        } catch (e) {
            return { success: false, error: `Failed to save persona: ${e.message}` };
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Prompt rendering                                                   */
    /* ------------------------------------------------------------------ */

    /**
     * Render the active persona into a system prompt block.
     * Converts the structured persona config into natural language that
     * gets prepended to the system prompt.
     *
     * @returns {string} Rendered persona prompt, or empty string
     */
    renderPersonaPrompt() {
        const persona = this.getActivePersona();
        if (!persona) return '';

        const sections = [];

        // Core Identity
        sections.push(`# CORE IDENTITY: ${persona.name}`);
        if (persona.identity?.coreDirective) {
            sections.push(persona.identity.coreDirective);
        }
        if (persona.identity?.relationship) {
            sections.push(`\n${persona.identity.relationship}`);
        }

        // Mission Priorities
        if (persona.mission && persona.mission.length > 0) {
            sections.push('\n# MISSION PRIORITIES');
            for (const m of persona.mission) {
                sections.push(`${m.priority}. **${m.label}:** ${m.description}`);
            }
        }

        // Operational Behavior
        if (persona.operationalBehavior) {
            sections.push('\n# OPERATIONAL BEHAVIOR');
            if (persona.operationalBehavior.loop) {
                sections.push(`Loop: **${persona.operationalBehavior.loop}**`);
            }
            if (persona.operationalBehavior.rules) {
                for (const rule of persona.operationalBehavior.rules) {
                    sections.push(`- ${rule}`);
                }
            }
        }

        // Tool Guidance
        if (persona.toolGuidance && Object.keys(persona.toolGuidance).length > 0) {
            sections.push('\n# TOOL USAGE GUIDANCE');
            for (const [toolArea, guidance] of Object.entries(persona.toolGuidance)) {
                sections.push(`- **${toolArea}:** ${guidance}`);
            }
        }

        // Communication Style
        if (persona.communicationStyle) {
            sections.push('\n# COMMUNICATION STYLE');
            if (persona.identity?.voice) {
                sections.push(`**Voice:** ${persona.identity.voice}`);
            }
            if (persona.communicationStyle.startConversations) {
                sections.push('**Proactive:** Initiate when user is silent.');
            }
            if (persona.communicationStyle.examplePhrases?.length > 0) {
                sections.push('Example conversation starters:');
                for (const phrase of persona.communicationStyle.examplePhrases) {
                    sections.push(`- "${phrase}"`);
                }
            }
            if (persona.communicationStyle.validateEarlyWork) {
                const validationText = typeof persona.communicationStyle.validateEarlyWork === 'string'
                    ? persona.communicationStyle.validateEarlyWork
                    : "Validate the user's efforts and acknowledge challenges.";
                sections.push(`**Validation:** ${validationText}`);
            }
        }

        // Special Instructions
        if (persona.specialInstructions && persona.specialInstructions.length > 0) {
            sections.push('\n# SPECIAL INSTRUCTIONS');
            for (const instruction of persona.specialInstructions) {
                if (typeof instruction === 'string') {
                    sections.push(`- ${instruction}`);
                } else {
                    sections.push(`\n## ${instruction.label || instruction.id}`);
                    if (instruction.content) sections.push(instruction.content);
                    if (instruction.directives) {
                        for (const d of instruction.directives) {
                            sections.push(`- ${d}`);
                        }
                    }
                }
            }
        }

        // Bootstrap
        if (persona.bootstrap?.onFirstLoad) {
            sections.push(`\n# EXECUTION\n${persona.bootstrap.onFirstLoad}`);
        }

        sections.push('\n---\n');

        return sections.join('\n');
    }

    /* ------------------------------------------------------------------ */
    /*  Misc                                                               */
    /* ------------------------------------------------------------------ */

    getBootstrapConfig() {
        const persona = this.getActivePersona();
        if (!persona?.bootstrap) return null;
        return persona.bootstrap;
    }

    async switchWorkspace(newWorkingDir) {
        this.workingDir = newWorkingDir;
        this.personasDir = path.join(newWorkingDir, '.oboto', 'personas');
        this.personas.clear();
        this.activePersonaId = null;
        this._initialized = false;
        await this.initialize();
    }
}
