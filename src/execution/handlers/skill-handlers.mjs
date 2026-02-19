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
            return "No skills found in global (skills) or workspace (.skills) directories.";
        }

        return `Available Skills:\n${skills.map(s => `- ${s.name} [${s.source}]: ${s.description}`).join('\n')}`;
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
            
            const prompt = `Execute task using the '${skill.name}' skill.

SKILL DOCS:
${skill.content}

TASK: ${task}

STEPS:
1. Follow skill documentation to perform the task.
2. Use tools (shell, file) to execute required commands.
3. Report final outcome.`;

            const result = await subAgent.run(prompt);
            return `Skill Execution Result (${skill_name}):\n${result}`;

        } catch (error) {
            consoleStyler.log('error', `Skill execution failed: ${error.message}`);
            return `Error executing skill '${skill_name}': ${error.message}`;
        }
    }

    async addNpmSkill(args) {
        await this.skillsManager.ensureInitialized();
        const { packages } = args;
        
        try {
            consoleStyler.log('system', `Adding NPM skills: ${packages.join(', ')}`);
            const result = await this.skillsManager.addNpmSkills(packages);
            return result;
        } catch (error) {
            consoleStyler.log('error', `Failed to add NPM skills: ${error.message}`);
            return `Error adding npm skills: ${error.message}`;
        }
    }
}
