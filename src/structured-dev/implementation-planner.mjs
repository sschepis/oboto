// Implementation Planner
// Analyzes the System Map to generate a parallel execution plan for multi-agent implementation.

import { ManifestManager } from './manifest-manager.mjs';
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

    // Schedule tasks into parallel stages using topological sort logic with resource constraints
    scheduleTasks(features, numDevelopers = 3) {
        const pendingFeatures = features.filter(f => f.status !== 'Completed');
        const completedFeatureIds = new Set(features.filter(f => f.status === 'Completed').map(f => f.id));
        
        // Build adjacency list and in-degree map for pending tasks
        const graph = new Map(); // id -> [dependents]
        const inDegree = new Map(); // id -> count of pending dependencies
        const featureMap = new Map(); // id -> feature object

        // Initialize
        pendingFeatures.forEach(f => {
            featureMap.set(f.id, f);
            inDegree.set(f.id, 0);
            if (!graph.has(f.id)) graph.set(f.id, []);
        });

        // Populate graph based on dependencies
        pendingFeatures.forEach(feature => {
            feature.dependencies.forEach(depId => {
                // If dependency is already completed, it doesn't block
                if (completedFeatureIds.has(depId)) return;

                // If dependency is pending, add edge
                if (featureMap.has(depId)) {
                    if (!graph.has(depId)) graph.set(depId, []);
                    graph.get(depId).push(feature.id);
                    inDegree.set(feature.id, (inDegree.get(feature.id) || 0) + 1);
                } else {
                    // Dependency exists but not in our list (external or typo)
                    // We should treat this as a potential blocker or at least warn.
                    // For robustness, we'll log it but not block, assuming manual resolution or external dependency.
                    console.warn(`[ImplementationPlanner] Warning: Feature ${feature.id} depends on unknown/missing feature ${depId}. Ignoring dependency.`);
                }
            });
        });

        const stages = [];
        let readyQueue = [];

        // Initial set of ready tasks (in-degree 0)
        inDegree.forEach((count, id) => {
            if (count === 0) readyQueue.push(id);
        });

        // Simple List Scheduling Algorithm
        // While we have tasks to schedule
        while (readyQueue.length > 0) {
            // Take up to numDevelopers tasks for this stage
            // We sort by number of dependents (heuristic: prioritize tasks that unlock more work)
            readyQueue.sort((a, b) => {
                const depsA = graph.get(a)?.length || 0;
                const depsB = graph.get(b)?.length || 0;
                return depsB - depsA; // Descending
            });

            const currentStageTasks = readyQueue.splice(0, numDevelopers);
            
            // Map IDs to full feature objects for the plan
            const stageTasksWithDetails = currentStageTasks.map(id => featureMap.get(id));

            stages.push({
                id: stages.length + 1,
                tasks: stageTasksWithDetails
            });

            // Simulate completion of these tasks to find new ready tasks
            const nextReady = [];
            
            for (const completedId of currentStageTasks) {
                const dependents = graph.get(completedId) || [];
                for (const dependentId of dependents) {
                    inDegree.set(dependentId, inDegree.get(dependentId) - 1);
                    if (inDegree.get(dependentId) === 0) {
                        nextReady.push(dependentId);
                    }
                }
            }

            // Add newly ready tasks to the queue
            readyQueue.push(...nextReady);
        }

        // Check for cycles (remaining in-degrees > 0)
        const unscheduled = [];
        inDegree.forEach((count, id) => {
            if (count > 0) unscheduled.push(id);
        });

        if (unscheduled.length > 0) {
            throw new Error(`Cyclic dependency or unresolvable dependencies detected for features: ${unscheduled.join(', ')}`);
        }

        return stages;
    }
}
