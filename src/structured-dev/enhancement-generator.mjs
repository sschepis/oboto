import { KnowledgeGraphBuilder } from './knowledge-graph-builder.mjs';
import { FileTools } from '../tools/file-tools.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import path from 'path';

export class EnhancementGenerator {
    constructor(workspaceRoot, aiAssistantClass) {
        this.workspaceRoot = workspaceRoot;
        this.AiAssistant = aiAssistantClass;
        this.knowledgeGraphBuilder = new KnowledgeGraphBuilder(workspaceRoot);
        this.fileTools = new FileTools(workspaceRoot);
    }

    /**
     * Generates a list of enhancements based on codebase analysis.
     * @param {string} category - The category of enhancements to focus on.
     * @param {string[]} focusDirs - Specific directories to focus analysis on.
     * @returns {Promise<any>} - List of enhancements or analysis context.
     */
    async generateEnhancements(category = 'all', focusDirs = []) {
        consoleStyler.log('system', `Generating ${category} enhancements...`, { box: true });

        // 1. Build Knowledge Graph
        consoleStyler.log('working', 'Building knowledge graph for context...');
        const graph = await this.knowledgeGraphBuilder.buildGraph();
        
        // Filter nodes if focusDirs provided
        let relevantNodes = graph.nodes;
        if (focusDirs && focusDirs.length > 0) {
            relevantNodes = graph.nodes.filter(node => {
                if (!node.data || !node.data.path) return false;
                return focusDirs.some(dir => node.data.path.startsWith(dir));
            });
        }

        // 2. Read System Map
        let systemMap = '';
        try {
            systemMap = await this.fileTools.readFile({ path: 'SYSTEM_MAP.md' });
        } catch (e) {
            consoleStyler.log('warning', 'SYSTEM_MAP.md not found. Analysis might be less accurate.');
        }

        // 3. Construct Context
        const context = `
Project Analysis Context:
- Total Files: ${graph.nodes.length}
- Focused Files: ${relevantNodes.length}
- Category: ${category}

System Map Excerpt:
${systemMap.slice(0, 5000)}...

Knowledge Graph Summary (Top 50 nodes):
${JSON.stringify(relevantNodes.slice(0, 50), null, 2)}
`;

        // 4. Use AI Assistant if available
        if (this.AiAssistant) {
            consoleStyler.log('ai', 'Using AI Assistant to analyze code and generate suggestions...');
            try {
                const agent = new this.AiAssistant(this.workspaceRoot);
                
                const prompt = `Generate 3-5 high-impact ${category} enhancements for this project.

${context}

Return JSON ONLY:
{"enhancements": [{"id": "string", "title": "string", "description": "string", "type": "refactor|feature|security|performance", "priority": "high|medium|low", "affected_files": ["string"]}]}
`;
                const response = await agent.run(prompt, { responseFormat: { type: "json_object" } });
                
                // improved json parsing
                let jsonStr = response;
                // Handle potential markdown wrapping even in json_object mode
                const jsonBlock = response.match(/```json\n([\s\S]*?)\n```/);
                if (jsonBlock) {
                    jsonStr = jsonBlock[1];
                } else {
                    const simpleBlock = response.match(/```\n([\s\S]*?)\n```/);
                    if (simpleBlock) {
                         jsonStr = simpleBlock[1];
                    }
                }
                
                try {
                    const parsed = JSON.parse(jsonStr);
                    // Handle both array (legacy/fallback) and object with key
                    const enhancements = Array.isArray(parsed) ? parsed : (parsed.enhancements || []);
                    return enhancements;
                } catch (e) {
                    consoleStyler.log('warning', `JSON parse failed, attempting regex cleanup: ${e.message}`);
                    // Fallback to regex extraction if strict parse fails
                    try {
                        // ...existing regex logic or just return text...
                        // Since we are enforcing json_object, this path should be rare.
                         return response; 
                    } catch (e2) {
                        return response;
                    }
                }
            } catch (error) {
                consoleStyler.log('error', `AI Analysis failed: ${error.message}`);
                return `Analysis failed: ${error.message}. Context provided above.`;
            }
        } else {
            return `AI Assistant not available. Context:\n${context}`;
        }
    }

    /**
     * Implements a list of enhancements.
     * @param {Array} enhancements - List of enhancement objects.
     * @returns {Promise<Object>} - Execution results.
     */
    async implementEnhancements(enhancements) {
        if (!this.AiAssistant) {
            return { success: false, message: "AI Assistant not available for implementation." };
        }

        if (!Array.isArray(enhancements) || enhancements.length === 0) {
             return { success: false, message: "No enhancements provided." };
        }

        consoleStyler.log('system', `Implementing ${enhancements.length} enhancements...`, { box: true });
        
        const results = [];

        for (const enhancement of enhancements) {
            consoleStyler.log('working', `>>> Implementing: ${enhancement.title}`, { box: true });
            
            try {
                const agent = new this.AiAssistant(this.workspaceRoot);
                
                const prompt = `Implement this enhancement:

Title: ${enhancement.title}
Description: ${enhancement.description}
Type: ${enhancement.type}
Files: ${enhancement.affected_files ? enhancement.affected_files.join(', ') : 'Unknown'}

STEPS:
1. Read affected files.
2. Implement changes.
3. Verify (run tests or check syntax).
4. Report what changed.`;
                const response = await agent.run(prompt);
                
                results.push({
                    id: enhancement.id || 'unknown',
                    title: enhancement.title,
                    success: true,
                    output: response
                });
                
                consoleStyler.log('success', `✓ Completed: ${enhancement.title}`);

            } catch (error) {
                consoleStyler.log('error', `✗ Failed: ${enhancement.title} - ${error.message}`);
                results.push({
                    id: enhancement.id || 'unknown',
                    title: enhancement.title,
                    success: false,
                    error: error.message
                });
            }
        }

        return {
            success: true,
            message: `Completed ${results.filter(r => r.success).length}/${results.length} enhancements.`,
            details: results
        };
    }
}
