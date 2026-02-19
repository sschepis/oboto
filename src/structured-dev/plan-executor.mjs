// Plan Executor
// Orchestrates the concurrent execution of multi-agent implementation plans.

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';

export class PlanExecutor {
    constructor(manifestManager, aiAssistantClass) {
        this.manifestManager = manifestManager;
        this.AiAssistant = aiAssistantClass;
        this.concurrencyLimit = 3; // Max concurrent agents
    }

    // Load and execute a plan
    async executePlan(planPath) {
        if (!fs.existsSync(planPath)) {
            return { success: false, message: `Plan file not found: ${planPath}` };
        }

        const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
        const stages = plan.stages;
        const totalStages = stages.length;

        consoleStyler.log('system', `Starting execution of ${totalStages} stages...`, { box: true });

        const results = [];

        for (let i = 0; i < totalStages; i++) {
            const stage = stages[i];
            consoleStyler.log('system', `>>> Executing Stage ${stage.id}/${totalStages} with ${stage.tasks.length} tasks`, { box: true });
            
            // Execute stage with concurrency control
            const stageResults = await this.executeStage(stage.tasks);
            results.push({ stage: stage.id, results: stageResults });

            // Check for failures
            const failures = stageResults.filter(r => !r.success);
            if (failures.length > 0) {
                consoleStyler.log('error', `Stage ${stage.id} failed with ${failures.length} errors. Stopping execution.`);
                return { success: false, message: `Execution stopped at Stage ${stage.id} due to failures.`, details: results };
            }
            
            consoleStyler.log('system', `✓ Stage ${stage.id} completed successfully.`);
        }

        return { success: true, message: "All stages completed successfully.", details: results };
    }

    // Execute a list of tasks concurrently
    async executeStage(tasks) {
        // tasks is now an array of feature objects: { id, status, phase, dependencies }
        const executions = tasks.map(task => this.executeTask(task));
        return await Promise.all(executions);
    }

    // Execute a single task with an isolated AI agent
    async executeTask(task) {
        const workingDir = this.manifestManager.workingDir;
        const taskId = task.id || task; // Handle object or string ID for backward compat
        const taskName = task.name || "Unknown Feature";
        
        consoleStyler.log('working', `[${taskId}] Spawning agent for ${taskName}...`);

        try {
            // Instantiate a new AI agent for this task
            const agent = new this.AiAssistant(workingDir);
            
            const prompt = `Implement feature ${taskId} (${taskName}). You own ONLY this feature.

Status: ${task.status || 'Active'} | Phase: ${task.phase || 'Implementation'} | Dependencies: ${task.dependencies ? task.dependencies.join(', ') : 'None'}

STEPS:
1. Read \`SYSTEM_MAP.md\` and any design docs for ${taskId}.
2. \`list_files\` to understand project structure and naming conventions.
3. Implement core logic. FOLLOW interfaces exactly.
4. Write unit tests with high coverage.
5. Add error handling, edge cases, JSDoc on public APIs.
6. Update SYSTEM_MAP.md status to 'Completed' ONLY after all steps done.`;

            // Run the agent
            // We use run() which runs the conversation loop until completion
            const response = await agent.run(prompt);

            consoleStyler.log('success', `[${taskId}] Agent finished: ${response.substring(0, 50)}...`);

            return {
                taskId: taskId,
                success: true,
                output: response
            };

        } catch (error) {
            consoleStyler.log('error', `[${taskId}] Agent failed: ${error.message}`);
            return {
                taskId: taskId,
                success: false,
                error: error.message
            };
        }
    }
}
