import { ManifestManager } from './manifest-manager.mjs';

/**
 * Generates C4 Architecture diagrams using Mermaid.js syntax.
 * Focuses on visualizing the system based on the SYSTEM_MAP.md manifest.
 */
export class C4Visualizer {
    /**
     * @param {ManifestManager} manifestManager 
     */
    constructor(manifestManager) {
        this.manifestManager = manifestManager;
    }

    /**
     * Generates a C4 Component diagram based on features defined in the manifest.
     * @returns {Promise<string>} Mermaid C4 syntax
     */
    async generateComponentDiagram() {
        const manifest = await this.manifestManager.readManifest();
        if (!manifest) {
            return "graph TD\n    Error[No manifest found]";
        }

        const features = this._parseFeatures(manifest);
        const dependencies = this._parseDependencies(manifest);

        let mermaid = 'C4Context\n';
        mermaid += '    title System Component Diagram (from SYSTEM_MAP.md)\n\n';

        // Define the System Boundary
        mermaid += '    Boundary(b0, "Robodev System", "AI Development Assistant") {\n';

        // Add Features as Components
        features.forEach(feat => {
            // Sanitize ID and Name
            const id = feat.id.replace(/-/g, '_');
            const name = feat.name.replace(/"/g, "'");
            const desc = `${feat.status} | ${feat.priority}`;
            
            mermaid += `        Component(${id}, "${name}", "Feature", "${desc}")\n`;
        });

        mermaid += '    }\n\n';

        // Add Relationships
        dependencies.forEach(dep => {
            const from = dep.from.replace(/-/g, '_');
            const to = dep.to.replace(/-/g, '_');
            mermaid += `    Rel(${from}, ${to}, "depends on")\n`;
        });

        return mermaid;
    }

    /**
     * extract features from markdown table
     * @param {string} manifestContent 
     * @returns {Array<{id:string, name:string, status:string, priority:string}>}
     */
    _parseFeatures(manifestContent) {
        const lines = manifestContent.split('\n');
        const features = [];
        let inRegistry = false;

        for (const line of lines) {
            if (line.includes('## 2. Feature Registry')) {
                inRegistry = true;
                continue;
            }
            if (inRegistry && line.startsWith('##')) {
                inRegistry = false;
                break;
            }
            if (inRegistry && line.trim().startsWith('|') && !line.includes('Feature ID') && !line.includes('---')) {
                // Parse table row
                // | Feature ID | Name | Status | ...
                const parts = line.split('|').map(p => p.trim()).filter(p => p);
                if (parts.length >= 4) {
                    features.push({
                        id: parts[0],
                        name: parts[1],
                        status: parts[2],
                        priority: parts[5] || 'Unknown' // Assuming priority is 6th col based on SYSTEM_MAP.md structure
                    });
                }
            }
        }
        return features;
    }

    /**
     * extract dependencies from markdown list
     * @param {string} manifestContent 
     * @returns {Array<{from:string, to:string}>}
     */
    _parseDependencies(manifestContent) {
        const lines = manifestContent.split('\n');
        const deps = [];
        let inDeps = false;

        for (const line of lines) {
            if (line.includes('## 3. Dependency Graph')) {
                inDeps = true;
                continue;
            }
            if (inDeps && line.startsWith('##')) {
                inDeps = false;
                break;
            }
            if (inDeps && line.trim().startsWith('-')) {
                // - FEAT-002: Auth -> FEAT-001
                // This parsing depends on how FlowManager writes dependencies.
                // Standard format is often implied by the 'Dependencies' column in Feature Registry,
                // but the Dependency Graph section explicitly lists them.
                // Let's assume a format like: "- FEAT-XXX depends on FEAT-YYY" or simply extracting from the registry if the graph section is free-text.
                
                // Actually, looking at SYSTEM_MAP.md line 16: "- FEAT-000: System Init"
                // It seems to just list nodes.
                // Let's try to parse explicit "->" relationships if they exist, or fallback to registry "Dependencies" column.
            }
        }
        
        // Fallback: Parse from Feature Registry 'Dependencies' column (index 6)
        const featuresLines = manifestContent.split('\n');
        let inReg = false;
        for (const line of featuresLines) {
            if (line.includes('## 2. Feature Registry')) {
                inReg = true;
                continue;
            }
            if (inReg && line.startsWith('##')) break;
            
            if (inReg && line.trim().startsWith('|') && !line.includes('Feature ID') && !line.includes('---')) {
                const parts = line.split('|').map(p => p.trim()).filter(p => p);
                if (parts.length >= 7) {
                    const id = parts[0];
                    const depStr = parts[6]; // Dependencies column
                    
                    if (depStr && depStr !== '-') {
                        const targets = depStr.split(',').map(d => d.trim());
                        for (const target of targets) {
                            deps.push({ from: id, to: target });
                        }
                    }
                }
            }
        }

        return deps;
    }
}
