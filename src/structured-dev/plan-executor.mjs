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
            
            // Context Prompt
            const prompt = `
Task: Implement Feature ${taskId} (${taskName})
Role: You are a specialized implementation agent working in parallel with others.
Context: 
- You are responsible ONLY for feature ${taskId}.
- Current Status: ${task.status || 'Active'}
- Phase: ${task.phase || 'Implementation'}
- Dependencies: ${task.dependencies ? task.dependencies.join(', ') : 'None'}
- Read the 'SYSTEM_MAP.md' to understand the full system context.
- Read any design docs or interfaces related to ${taskId} (check 'src/' or 'docs/').

Execution Steps:
1.  **Project Context Analysis**: Scan the existing project structure (using \`list_files\`) to understand the directory layout, naming conventions, and architectural patterns. Derive the appropriate location for your new files based on this context.
2.  **Implementation**: Write the core logic for the feature. Ensure strict adherence to interfaces.
3.  **Unit Test Generation**: Create comprehensive unit tests for the implemented code. Aim for high coverage.
4.  **Production Refinement**: Review your code for error handling, edge cases, and performance. Refactor for clarity and maintainability.
5.  **Documentation**: Add JSDoc comments to all public functions and classes. Create or update a README.md for the module if appropriate.
6.  **Finalize**: Update the SYSTEM_MAP.md status to 'Completed' only after all above steps are done.

Action: execute these steps now.
`;

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
