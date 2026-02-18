import path from 'path';
import { FileTools } from '../tools/file-tools.mjs';

/**
 * Builds a knowledge graph of the codebase.
 * Maps files, classes, and dependencies.
 */
export class KnowledgeGraphBuilder {
    /**
     * @param {string} workspaceRoot 
     */
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.fileTools = new FileTools(workspaceRoot);
    }

    /**
     * Scans the codebase and builds a graph of files and dependencies.
     * @returns {Promise<{nodes: Array, edges: Array}>}
     */
    async buildGraph() {
        const allFiles = await this.fileTools.listFiles({ path: '.', recursive: true });
        // Filter for source files (js, mjs, ts)
        const sourceFiles = allFiles.filter(f => 
            (f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.ts')) && 
            !f.includes('node_modules') && 
            !f.includes('.git')
        );

        const nodes = [];
        const edges = [];

        // 1. Create nodes for all files
        for (const file of sourceFiles) {
            nodes.push({
                id: file,
                type: 'file',
                label: path.basename(file),
                data: { path: file }
            });
        }

        // 2. Parse files for imports/exports to create edges
        for (const file of sourceFiles) {
            try {
                const content = await this.fileTools.readFile({ path: file });
                const imports = this._extractImports(content);

                for (const imp of imports) {
                    const resolvedPath = this._resolveImport(file, imp);
                    if (resolvedPath && sourceFiles.includes(resolvedPath)) {
                        edges.push({
                            source: file,
                            target: resolvedPath,
                            type: 'import'
                        });
                    }
                }
                
                // Extract Class definitions (simple regex)
                const classes = this._extractClasses(content);
                for (const cls of classes) {
                    const classNodeId = `${file}#${cls}`;
                    nodes.push({
                        id: classNodeId,
                        type: 'class',
                        label: cls,
                        data: { file: file }
                    });
                    edges.push({
                        source: classNodeId,
                        target: file,
                        type: 'defined_in'
                    });
                }

            } catch (e) {
                console.error(`Failed to parse ${file}: ${e.message}`);
            }
        }

        return { nodes, edges };
    }

    _extractImports(content) {
        const imports = [];
        // Regex for ESM imports: import ... from 'path';
        const regex = /import\s+(?:[\s\S]*?)\s+from\s+['"](.*?)['"]/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            imports.push(match[1]);
        }
        return imports;
    }

    _extractClasses(content) {
        const classes = [];
        // Regex for class definitions: class MyClass ...
        const regex = /class\s+(\w+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            classes.push(match[1]);
        }
        return classes;
    }

    _resolveImport(sourceFile, importPath) {
        if (importPath.startsWith('.')) {
            const dir = path.dirname(sourceFile);
            // Resolve relative path
            // Note: This simple resolution doesn't handle omitting extensions (common in Node), 
            // but our project uses explicit extensions (.mjs) mostly.
            // We can try adding extensions if not present.
            
            let resolved = path.join(dir, importPath);
            // Normalize separators (Windows fix if needed, though we are in POSIX mostly)
            resolved = resolved.replace(/\\/g, '/');
            
            return resolved;
        }
        return null; // Ignore node_modules imports for now
    }
}
