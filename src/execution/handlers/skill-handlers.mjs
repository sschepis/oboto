import { consoleStyler } from '../../ui/console-styler.mjs';

export class SkillHandlers {
    constructor(skillsManager, aiAssistantClass) {
        this.skillsManager = skillsManager;
        this.aiAssistantClass = aiAssistantClass;
    }

    async listSkills() {
        await this.skillsManager.ensureInitialized();
        const skills = this.skillsManager.listSkills();
        
        if (skills.length === 0) {
            return "No skills found in workspace (.skills directory).";
        }

        return `Available Skills:\n${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`;
    }

    async readSkill(args) {
        await this.skillsManager.ensureInitialized();
        const { skill_name } = args;
        const skill = this.skillsManager.getSkill(skill_name);

        if (!skill) {
            return `Skill '${skill_name}' not found. Use 'list_skills' to see available skills.`;
        }

        return `SKILL: ${skill.name}\n\n${skill.content}`;
    }

    async useSkill(args) {
        await this.skillsManager.ensureInitialized();
        const { skill_name, task } = args;
        const skill = this.skillsManager.getSkill(skill_name);

        if (!skill) {
            return `Skill '${skill_name}' not found.`;
        }

        if (!this.aiAssistantClass) {
            return "Error: AI Assistant class not available for skill execution.";
        }

        consoleStyler.log('ai', `🧠 Executing Skill: ${skill_name} -> ${task}`);

        try {
            // Create a sub-agent for this skill
            // We use the same working directory
            const subAgent = new this.aiAssistantClass(this.skillsManager.workspaceRoot);
            
            // Initialize tools (this loads custom tools + system prompt)
            await subAgent.initializeCustomTools();
            
            const prompt = `You are acting as a specialist agent for the '${skill.name}' skill.

SKILL DOCUMENTATION:
${skill.content}

YOUR ASSIGNMENT:
${task}

INSTRUCTIONS:
1. Use the skill documentation above to understand how to perform the task.
2. Use your available tools (shell, file, etc.) to execute the necessary commands.
3. If the skill requires running CLI commands, run them.
4. Report the final outcome clearly.

Begin execution.`;

            const result = await subAgent.run(prompt);
            return `Skill Execution Result (${skill_name}):\n${result}`;

        } catch (error) {
            consoleStyler.log('error', `Skill execution failed: ${error.message}`);
            return `Error executing skill '${skill_name}': ${error.message}`;
        }
    }
}
