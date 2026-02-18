import fs from 'fs/promises';
import path from 'path';

export class SkillsManager {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.skillsDir = path.join(workspaceRoot, '.skills');
        this.skills = new Map(); // name -> { metadata, content, path }
        this.initialized = false;
    }

    async ensureInitialized() {
        if (this.initialized) return;
        await this.loadSkills();
        this.initialized = true;
    }

    async loadSkills() {
        this.skills.clear();
        
        try {
            // Check if .skills exists
            try {
                await fs.access(this.skillsDir);
            } catch {
                return; // No skills dir, that's fine
            }

            // Scan .skills directory
            // Supports:
            // .skills/my-skill.md
            // .skills/my-skill/SKILL.md
            
            const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
            
            for (const entry of entries) {
                let skillPath = null;
                
                if (entry.isDirectory()) {
                    // Check for SKILL.md inside
                    const subPath = path.join(this.skillsDir, entry.name, 'SKILL.md');
                    try {
                        await fs.access(subPath);
                        skillPath = subPath;
                    } catch {
                        // Ignore directories without SKILL.md
                    }
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    skillPath = path.join(this.skillsDir, entry.name);
                }

                if (skillPath) {
                    await this.parseSkill(skillPath);
                }
            }
        } catch (error) {
            console.error(`Failed to load skills: ${error.message}`);
        }
    }

    async parseSkill(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const { metadata, body } = this.extractFrontmatter(content);
            
            const name = metadata.name || path.basename(path.dirname(filePath));
            
            this.skills.set(name, {
                name,
                description: metadata.description || '',
                metadata,
                content: body,
                path: filePath
            });
        } catch (error) {
            console.error(`Error parsing skill at ${filePath}: ${error.message}`);
        }
    }

    // Simple frontmatter parser
    extractFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
            const yaml = match[1];
            const body = match[2];
            const metadata = this.parseYaml(yaml);
            return { metadata, body };
        }
        return { metadata: {}, body: content };
    }

    // Very basic YAML parser (sufficient for simple skill metadata)
    // For robust parsing, we'd need 'js-yaml', but trying to avoid deps if possible.
    // If complex nested structures are used, this might break.
    // Given the example, it uses nested objects.
    // Let's implement a slightly better one or just use a regex for key fields.
    parseYaml(yaml) {
        const result = {};
        const lines = yaml.split('\n');
        
        // Simple key: value parser
        for (const line of lines) {
            const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
            if (keyMatch) {
                const key = keyMatch[1];
                let value = keyMatch[2].trim();
                
                // Remove quotes
                if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
                if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
                
                result[key] = value;
            }
        }
        return result;
    }

    listSkills() {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            description: s.description
        }));
    }

    getSkill(name) {
        return this.skills.get(name);
    }
    
    getSkillsSummary() {
        const skills = this.listSkills();
        if (skills.length === 0) return "";
        
        return "AVAILABLE SKILLS (Use 'read_skill' to view instructions):\n" + 
               skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    }
}
