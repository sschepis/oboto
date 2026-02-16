// Workspace management system
// Handles persistent workspace data for complex multi-step tasks

import { consoleStyler } from '../ui/console-styler.mjs';

export class WorkspaceManager {
    constructor() {
        this.workspace = null;
        this.workspaceActive = false;
    }

    // Manage workspace operations
    async manageWorkspace(args) {
        const { action, task_goal, current_step, progress_data, next_steps, status } = args;
        
        try {
            switch (action) {
                case 'create':
                    return this.createWorkspace(task_goal, current_step, progress_data, next_steps, status);
                
                case 'update':
                    return this.updateWorkspace(current_step, progress_data, next_steps, status);
                
                case 'show':
                    return this.showWorkspace();
                
                case 'clear':
                    return this.clearWorkspace();
                
                default:
                    return `Error: Unknown action '${action}'`;
            }
        } catch (error) {
            return `Error managing workspace: ${error.message}`;
        }
    }

    // Create a new workspace
    createWorkspace(task_goal, current_step, progress_data, next_steps, status) {
        if (!task_goal) {
            return "Error: task_goal is required for 'create' action";
        }
        
        this.workspace = {
            task_goal: task_goal,
            created_at: new Date().toISOString(),
            current_step: current_step || "Starting task",
            progress_data: progress_data || {},
            next_steps: next_steps || [],
            status: status || "in_progress",
            updated_at: new Date().toISOString()
        };
        
        this.workspaceActive = true;
        consoleStyler.log('workspace', `Created workspace for: ${task_goal}`);
        return `✓ Workspace created for task: ${task_goal}`;
    }

    // Update existing workspace
    updateWorkspace(current_step, progress_data, next_steps, status) {
        if (!this.workspace) {
            return "Error: No active workspace to update. Use 'create' first.";
        }
        
        if (current_step) this.workspace.current_step = current_step;
        if (progress_data) this.workspace.progress_data = { ...this.workspace.progress_data, ...progress_data };
        if (next_steps) this.workspace.next_steps = next_steps;
        if (status) this.workspace.status = status;
        this.workspace.updated_at = new Date().toISOString();
        
        consoleStyler.log('workspace', `Updated workspace: ${current_step || 'progress updated'}`);
        return `✓ Workspace updated: ${current_step || 'Progress data updated'}`;
    }

    // Show current workspace
    showWorkspace() {
        if (!this.workspace) {
            return "No active workspace";
        }
        
        return `Current Workspace:
• Task: ${this.workspace.task_goal}
• Status: ${this.workspace.status}
• Current Step: ${this.workspace.current_step}
• Progress Data: ${JSON.stringify(this.workspace.progress_data, null, 2)}
• Next Steps: ${this.workspace.next_steps.join(', ')}
• Last Updated: ${new Date(this.workspace.updated_at).toLocaleString()}`;
    }

    // Clear workspace
    clearWorkspace() {
        if (this.workspace) {
            consoleStyler.log('workspace', `Cleared workspace: ${this.workspace.task_goal}`);
            const clearedTask = this.workspace.task_goal;
            this.workspace = null;
            this.workspaceActive = false;
            return `✓ Cleared workspace: ${clearedTask}`;
        } else {
            return "No active workspace to clear";
        }
    }

    // Get current workspace
    getCurrentWorkspace() {
        return this.workspace;
    }

    // Check if workspace is active
    isWorkspaceActive() {
        return this.workspaceActive;
    }

    // Get workspace context for system prompt
    getWorkspaceContext() {
        if (!this.workspace) {
            return null;
        }
        
        return {
            task_goal: this.workspace.task_goal,
            current_step: this.workspace.current_step,
            status: this.workspace.status,
            progress_data: this.workspace.progress_data,
            next_steps: this.workspace.next_steps
        };
    }

    // Update workspace status
    updateStatus(status) {
        if (this.workspace) {
            this.workspace.status = status;
            this.workspace.updated_at = new Date().toISOString();
            consoleStyler.log('workspace', `Status updated to: ${status}`);
        }
    }

    // Add progress data
    addProgressData(key, value) {
        if (this.workspace) {
            this.workspace.progress_data[key] = value;
            this.workspace.updated_at = new Date().toISOString();
            consoleStyler.log('workspace', `Added progress data: ${key}`);
        }
    }

    // Update next steps
    updateNextSteps(steps) {
        if (this.workspace) {
            this.workspace.next_steps = steps;
            this.workspace.updated_at = new Date().toISOString();
            consoleStyler.log('workspace', `Updated next steps (${steps.length} items)`);
        }
    }

    // Set current step
    setCurrentStep(step) {
        if (this.workspace) {
            this.workspace.current_step = step;
            this.workspace.updated_at = new Date().toISOString();
            consoleStyler.log('workspace', `Current step: ${step}`);
        }
    }

    // Get workspace summary for logging
    getWorkspaceSummary() {
        if (!this.workspace) {
            return "No active workspace";
        }
        
        return `${this.workspace.task_goal} (${this.workspace.status}) - ${this.workspace.current_step}`;
    }

    // Save workspace to a file
    async save(filePath) {
        if (!this.workspaceActive || !this.workspace) {
            return false;
        }

        try {
            const fs = await import('fs');
            const data = {
                timestamp: new Date().toISOString(),
                workspace: this.workspace,
                workspaceActive: this.workspaceActive
            };
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (error) {
            consoleStyler.log('error', `Failed to save workspace: ${error.message}`);
            return false;
        }
    }

    // Load workspace from a file
    async load(filePath) {
        try {
            const fs = await import('fs');
            if (!fs.existsSync(filePath)) {
                return false;
            }
            
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (data.workspace) {
                this.workspace = data.workspace;
                this.workspaceActive = data.workspaceActive !== false;
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to load workspace: ${error.message}`);
            return false;
        }
    }
}