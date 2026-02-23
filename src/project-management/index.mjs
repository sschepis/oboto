// Project Management Module
// Structured processes for general-purpose project management
// Main entry point and exports

export { 
    ProjectManifest,
    PROJECT_PHASES,
    PHASE_ORDER,
    PROJECT_TYPES,
    PROJECT_STATUS,
    DELIVERABLE_STATUS,
    TASK_STATUS
} from './project-manifest.mjs';

export { PhaseController } from './phase-controller.mjs';
export { TaskScheduler } from './task-scheduler.mjs';
export { TemplateRegistry, BUILT_IN_TEMPLATES } from './template-registry.mjs';
export { SurfaceGenerator } from './surface-generator.mjs';
export { ProjectBootstrapper } from './project-bootstrapper.mjs';

/**
 * Create a complete project management system for a workspace
 * @param {string} workingDir - Workspace directory
 * @param {Object} surfaceManager - Optional SurfaceManager instance for UI generation
 * @returns {Object} Project management system instance
 */
export function createProjectManager(workingDir, surfaceManager = null) {
    const manifest = new (require('./project-manifest.mjs').ProjectManifest)(workingDir);
    const phaseController = new (require('./phase-controller.mjs').PhaseController)(manifest);
    const taskScheduler = new (require('./task-scheduler.mjs').TaskScheduler)(manifest);
    const templateRegistry = new (require('./template-registry.mjs').TemplateRegistry)(manifest);
    const bootstrapper = new (require('./project-bootstrapper.mjs').ProjectBootstrapper)(manifest);
    
    let surfaceGenerator = null;
    if (surfaceManager) {
        surfaceGenerator = new (require('./surface-generator.mjs').SurfaceGenerator)(surfaceManager);
    }

    return {
        manifest,
        phases: phaseController,
        tasks: taskScheduler,
        templates: templateRegistry,
        bootstrapper,
        surfaces: surfaceGenerator,

        // Convenience methods

        /**
         * Initialize a new project
         */
        async initProject(name, type, options = {}) {
            const { template, owner = '@user', createSurfaces = false } = options;
            
            let result;
            if (template) {
                result = await templateRegistry.createFromTemplate(name, template, { owner });
            } else {
                result = await manifest.initManifest(name, type, owner);
            }

            if (result.success && createSurfaces && surfaceGenerator) {
                await surfaceGenerator.createAllSurfaces(name);
            }

            return result;
        },

        /**
         * Bootstrap from existing docs
         */
        async bootstrap(targetDir = null) {
            return await bootstrapper.bootstrap(targetDir);
        },

        /**
         * Get project status report
         */
        async getStatus() {
            return await phaseController.getProgressReport();
        },

        /**
         * Execute phase transition
         */
        async nextPhase(options = {}) {
            const currentPhase = await phaseController.getCurrentPhase();
            const nextPhases = phaseController.getNextPhases(currentPhase);
            
            if (nextPhases.length === 0) {
                return { success: false, message: 'No valid next phase available.' };
            }

            return await phaseController.transitionTo(nextPhases[0], options);
        },

        /**
         * Add a goal
         */
        async addGoal(goal, metric, target) {
            return await manifest.addGoal(null, goal, metric, target);
        },

        /**
         * Add a deliverable
         */
        async addDeliverable(name, owner, phase) {
            return await manifest.addDeliverable(null, name, owner, phase);
        },

        /**
         * Add a task
         */
        async addTask(name, deliverable, assignee, priority = 'Medium') {
            return await manifest.addTask(null, name, deliverable, assignee, 'Todo', priority);
        },

        /**
         * Complete a task
         */
        async completeTask(taskId) {
            return await taskScheduler.completeTask(taskId);
        },

        /**
         * Create execution plan
         */
        async createPlan(options = {}) {
            return await taskScheduler.createExecutionPlan(options);
        },

        /**
         * Get available templates
         */
        getTemplates() {
            return templateRegistry.listTemplates();
        },

        /**
         * Suggest templates based on description
         */
        suggestTemplates(description) {
            return templateRegistry.suggestTemplates(description);
        }
    };
}

// Import dynamically for ESM compatibility
import { ProjectManifest } from './project-manifest.mjs';
import { PhaseController } from './phase-controller.mjs';
import { TaskScheduler } from './task-scheduler.mjs';
import { TemplateRegistry } from './template-registry.mjs';
import { SurfaceGenerator } from './surface-generator.mjs';
import { ProjectBootstrapper } from './project-bootstrapper.mjs';

/**
 * Factory function for ESM environments
 */
export function createProjectManagement(workingDir, surfaceManager = null) {
    const manifest = new ProjectManifest(workingDir);
    const phaseController = new PhaseController(manifest);
    const taskScheduler = new TaskScheduler(manifest);
    const templateRegistry = new TemplateRegistry(manifest);
    const bootstrapper = new ProjectBootstrapper(manifest);
    
    let surfaceGenerator = null;
    if (surfaceManager) {
        surfaceGenerator = new SurfaceGenerator(surfaceManager);
    }

    return {
        manifest,
        phases: phaseController,
        tasks: taskScheduler,
        templates: templateRegistry,
        bootstrapper,
        surfaces: surfaceGenerator,

        // Quick access to common operations
        async init(name, type = 'General', template = null) {
            if (template) {
                return templateRegistry.createFromTemplate(name, template);
            }
            return manifest.initManifest(name, type);
        },

        async bootstrap(dir) {
            return bootstrapper.bootstrap(dir);
        },

        async status() {
            return phaseController.getProgressReport();
        },

        async submitScope(doc) {
            return phaseController.submitScope(doc);
        },

        async approveScope(feedback) {
            return phaseController.approveScope(feedback);
        },

        async lockPlan() {
            return phaseController.lockPlan();
        },

        async submitReview(notes) {
            return phaseController.submitReview(notes);
        },

        async closeProject(retrospective) {
            return phaseController.closeProject(retrospective);
        },

        async createDashboard(name) {
            if (!surfaceGenerator) {
                return { success: false, message: 'SurfaceManager not provided' };
            }
            return surfaceGenerator.createProjectDashboard(name);
        }
    };
}
