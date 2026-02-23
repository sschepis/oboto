// Implementation Planner
// Analyzes the System Map to generate a parallel execution plan for multi-agent implementation.
// Refactored to use shared topologicalSchedule (see docs/DUPLICATE_CODE_ANALYSIS.md — DUP-3)

import { ManifestManager } from './manifest-manager.mjs';
import { topologicalSchedule } from '../lib/scheduling-utils.mjs';
import fs from 'fs';
import path from 'path';

export class ImplementationPlanner {
    constructor(manifestManager) {
        this.manifestManager = manifestManager;
    }

    // Main entry point to create a plan
    async createExecutionPlan(outputFile = 'implementation-plan.json', numDevelopers = 3) {
        if (!this.manifestManager.hasManifest()) {
            return { success: false, message: "No manifest found. Run init_structured_dev first." };
        }

        const manifest = await this.manifestManager.readManifest();
        const features = this.parseFeatureRegistry(manifest);
        
        if (features.length === 0) {
            return { success: false, message: "No features found in the registry." };
        }

        try {
            const stages = this.scheduleTasks(features, numDevelopers);
            const plan = {
                created_at: new Date().toISOString(),
                num_developers: numDevelopers,
                stages: stages
            };

            const planPath = path.join(this.manifestManager.workingDir, outputFile);
            await fs.promises.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');

            return { 
                success: true, 
                message: `Execution plan created with ${stages.length} stages for ${numDevelopers} developers.`,
                plan_path: planPath,
                plan: plan 
            };
        } catch (error) {
            return { success: false, message: `Failed to create plan: ${error.message}` };
        }
    }

    // Parse the Feature Registry table from markdown
    parseFeatureRegistry(manifestContent) {
        const lines = manifestContent.split('\n');
        const features = [];
        const featureMap = new Map();
        let inRegistry = false;

        // 1. Parse Registry Table
        for (const line of lines) {
            if (line.includes('## 2. Feature Registry')) {
                inRegistry = true;
                continue;
            }
            if (inRegistry && line.startsWith('## ')) {
                break; // End of section
            }
            
            if (inRegistry && line.trim().startsWith('|') && !line.includes('Feature ID') && !line.includes('---')) {
                const cols = line.split('|').map(c => c.trim());
                if (cols.length >= 8) {
                    const id = cols[1];
                    const name = cols[2];
                    const status = cols[3];
                    const phase = cols[4];
                    const priority = cols[6];
                    const depsRaw = cols[7];
                    
                    const dependencies = (depsRaw === '-' || !depsRaw) 
                        ? [] 
                        : depsRaw.split(',').map(d => d.trim());

                    const feature = {
                        id,
                        name,
                        status,
                        phase,
                        priority,
                        dependencies
                    };
                    features.push(feature);
                    featureMap.set(id, feature);
                }
            }
        }

        // 2. Parse Dependency Graph Section
        // Syntax: - FEAT-A -> FEAT-B, FEAT-C (Meaning A is a dependency for B and C)
        const graphRegex = /-\s*([A-Za-z0-9-]+)\s*->\s*(.+)/;
        let inGraph = false;

        for (const line of lines) {
            if (line.includes('## 3. Dependency Graph')) {
                inGraph = true;
                continue;
            }
            if (inGraph && line.startsWith('## ')) {
                break;
            }

            if (inGraph) {
                const match = line.match(graphRegex);
                if (match) {
                    const prerequisite = match[1].trim();
                    const dependents = match[2].split(',').map(d => d.trim());

                    dependents.forEach(depId => {
                        const feature = featureMap.get(depId);
                        if (feature) {
                            if (!feature.dependencies.includes(prerequisite)) {
                                feature.dependencies.push(prerequisite);
                            }
                        }
                    });
                }
            }
        }

        return features;
    }

    // Schedule tasks into parallel stages using shared topological sort
    scheduleTasks(features, numDevelopers = 3) {
        const { stages, unscheduled } = topologicalSchedule(features, {
            numParallel: numDevelopers,
            doneStatus: 'Completed'
        });

        if (unscheduled.length > 0) {
            throw new Error(`Cyclic dependency or unresolvable dependencies detected for features: ${unscheduled.join(', ')}`);
        }

        return stages;
    }
}
