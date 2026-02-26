import { FileTools } from '../tools/file-tools.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Generates API documentation from source code.
 */
export class ApiDocSmith {
    /**
     * @param {string} workspaceRoot 
     */
    constructor(workspaceRoot) {
        this.fileTools = new FileTools(workspaceRoot);
    }

    /**
     * Generates Markdown API documentation for the specified directory.
     * @param {string} targetDir - Directory to scan (default: src)
     * @returns {Promise<string>} Markdown documentation
     */
    async generateDocs(targetDir = 'src') {
        let files = [];
        try {
            files = await this.fileTools.listFiles({ path: targetDir, recursive: true });
        } catch (e) {
            return `Error: Could not list files in ${targetDir}. ${e.message}`;
        }

        const sourceFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts'));
        
        let markdown = `# API Reference\n\n`;
        markdown += `*Auto-generated from source code in \`${targetDir}\`*\n\n`;

        for (const file of sourceFiles) {
            try {
                const content = await this.fileTools.readFile({ path: file });
                const fileDocs = this._extractFileDocs(content, file);
                if (fileDocs) {
                    markdown += fileDocs;
                }
            } catch (e) {
                consoleStyler.log('error', `Failed to process ${file}: ${e.message}`);
            }
        }

        return markdown;
    }

    _extractFileDocs(content, filename) {
        let docs = `## File: \`${filename}\`\n\n`;
        let hasDocs = false;

        // Regex for JSDoc blocks followed by function/class/const
        // This is a simplified parser and won't catch everything perfectly
        const jsDocRegex = /\/\*\*([\s\S]*?)\*\/\s*(?:export\s+)?(?:async\s+)?(class|function|const|let|var)\s+(\w+)/g;
        
        let match;
        while ((match = jsDocRegex.exec(content)) !== null) {
            hasDocs = true;
            const comment = match[1];
            const type = match[2]; // class, function, etc
            const name = match[3]; // Identifier

            // Clean up comment lines
            const cleanComment = comment
                .split('\n')
                .map(line => line.replace(/^\s*\*\s?/, '').trim())
                .filter(line => line)
                .join('\n');

            docs += `### ${type} \`${name}\`\n\n`;
            docs += `${cleanComment}\n\n`;
        }

        // Also catch class methods if we found a class? 
        // Doing full AST parsing is better but regex is lighter.
        // Let's add a separate pass for methods inside classes if needed, 
        // but for now top-level exports are the main target.

        return hasDocs ? docs + '---\n\n' : '';
    }
}
