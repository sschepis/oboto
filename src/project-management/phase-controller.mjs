// Phase Controller
// Handles phase transitions with validation and hooks
// Enforces the project lifecycle flow

import {
    PROJECT_PHASES,
    PHASE_ORDER,
    PROJECT_STATUS,
    DELIVERABLE_STATUS,
    TASK_STATUS
} from './project-manifest.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * @typedef {Object} PhaseTransitionResult
 * @property {boolean} success - Whether transition was successful
 * @property {string} message - Result message
 * @property {string} [previousPhase] - Previous phase (if successful)
 * @property {string} [currentPhase] - Current phase (if successful)
 * @property {string[]} [warnings] - Non-blocking warnings
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {string[]} errors - Blocking errors
 * @property {string[]} warnings - Non-blocking warnings
 */

// Phase transition requirements
const PHASE_REQUIREMENTS = {
    [PROJECT_PHASES.IDEATION]: {
        canTransitionTo: [PROJECT_PHASES.SCOPING],
        requirements: {
            minGoals: 1,
            description: 'At least 1 goal must be defined'
        }
    },
    [PROJECT_PHASES.SCOPING]: {
        canTransitionTo: [PROJECT_PHASES.PLANNING],
        requirements: {
            minDeliverables: 1,
            minConstraints: 0,
            description: 'At least 1 deliverable must be defined'
        }
    },
    [PROJECT_PHASES.PLANNING]: {
        canTransitionTo: [PROJECT_PHASES.EXECUTION],
        requirements: {
            minTasks: 3,
            allTasksAssigned: true,
            description: 'At least 3 tasks defined, all tasks assigned'
        }
    },
    [PROJECT_PHASES.EXECUTION]: {
        canTransitionTo: [PROJECT_PHASES.REVIEW],
        requirements: {
            criticalTasksComplete: true,
            description: 'All high-priority tasks must be complete'
        }
    },
    [PROJECT_PHASES.REVIEW]: {
        canTransitionTo: [PROJECT_PHASES.CLOSURE],
        requirements: {
            allDeliverablesReviewed: true,
            description: 'All deliverables must be reviewed'
        }
    },
    [PROJECT_PHASES.CLOSURE]: {
        canTransitionTo: [],
        requirements: {
            description: 'Project is closed'
        }
    }
};

export class PhaseController {
    constructor(projectManifest) {
        this.manifest = projectManifest;
        this.hooks = new Map();
    }

    // Register a hook for phase transitions
    registerHook(event, callback) {
        if (!this.hooks.has(event)) {
            this.hooks.set(event, []);
        }
        this.hooks.get(event).push(callback);
    }

    // Execute hooks for an event
    async executeHooks(event, context) {
        const hooks = this.hooks.get(event) || [];
        for (const hook of hooks) {
            try {
                await hook(context);
            } catch (error) {
                consoleStyler.log('error', `Hook error for ${event}: ${error.message}`);
            }
        }
    }

    // Get the next allowed phases from current phase
    getNextPhases(currentPhase) {
        const config = PHASE_REQUIREMENTS[currentPhase];
        return config?.canTransitionTo || [];
    }

    // Get current phase
    async getCurrentPhase() {
        return await this.manifest.getCurrentPhase();
    }

    // Validate if transition to target phase is allowed
    async validateTransition(targetPhase, forceOverride = false) {
        const parsed = await this.manifest.parseManifest();
        if (!parsed) {
            return { valid: false, errors: ['No project manifest found.'], warnings: [] };
        }

        const currentPhase = parsed.meta?.current_phase || PROJECT_PHASES.IDEATION;
        const config = PHASE_REQUIREMENTS[currentPhase];
        const errors = [];
        const warnings = [];

        // Check if target phase is allowed
        if (!config.canTransitionTo.includes(targetPhase)) {
            if (!forceOverride) {
                errors.push(`Cannot transition from ${currentPhase} to ${targetPhase}. Allowed: ${config.canTransitionTo.join(', ') || 'none'}`);
            } else {
                warnings.push(`Force override: Skipping phase validation from ${currentPhase} to ${targetPhase}`);
            }
        }

        // Validate requirements for current phase exit
        if (!forceOverride) {
            const reqErrors = await this.validatePhaseRequirements(currentPhase, parsed);
            errors.push(...reqErrors);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    // Validate specific phase requirements
    async validatePhaseRequirements(phase, parsed) {
        const config = PHASE_REQUIREMENTS[phase];
        const req = config?.requirements || {};
        const errors = [];

        switch (phase) {
            case PROJECT_PHASES.IDEATION:
                if (req.minGoals && parsed.goals.length < req.minGoals) {
                    errors.push(`Ideation exit requires at least ${req.minGoals} goal(s). Found: ${parsed.goals.length}`);
                }
                break;

            case PROJECT_PHASES.SCOPING:
                if (req.minDeliverables && parsed.deliverables.length < req.minDeliverables) {
                    errors.push(`Scoping exit requires at least ${req.minDeliverables} deliverable(s). Found: ${parsed.deliverables.length}`);
                }
                break;

            case PROJECT_PHASES.PLANNING:
                if (req.minTasks && parsed.tasks.length < req.minTasks) {
                    errors.push(`Planning exit requires at least ${req.minTasks} task(s). Found: ${parsed.tasks.length}`);
                }
                if (req.allTasksAssigned) {
                    const unassigned = parsed.tasks.filter(t => !t.assignee || t.assignee === '-' || t.assignee === '');
                    if (unassigned.length > 0) {
                        errors.push(`All tasks must be assigned. Unassigned: ${unassigned.map(t => t.id).join(', ')}`);
                    }
                }
                break;

            case PROJECT_PHASES.EXECUTION:
                if (req.criticalTasksComplete) {
                    const criticalIncomplete = parsed.tasks.filter(
                        t => t.priority === 'High' && t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED
                    );
                    if (criticalIncomplete.length > 0) {
                        errors.push(`All high-priority tasks must be complete. Incomplete: ${criticalIncomplete.map(t => t.id).join(', ')}`);
                    }
                }
                break;

            case PROJECT_PHASES.REVIEW:
                if (req.allDeliverablesReviewed) {
                    const unreviewed = parsed.deliverables.filter(
                        d => d.status !== DELIVERABLE_STATUS.COMPLETED && d.status !== DELIVERABLE_STATUS.CANCELLED
                    );
                    if (unreviewed.length > 0) {
                        errors.push(`All deliverables must be completed or cancelled. Pending: ${unreviewed.map(d => d.id).join(', ')}`);
                    }
                }
                break;
        }

        return errors;
    }

    // Transition to next phase
    async transitionTo(targetPhase, options = {}) {
        const { forceOverride = false, notes = '' } = options;

        // Validate transition
        const validation = await this.validateTransition(targetPhase, forceOverride);
        if (!validation.valid) {
            return {
                success: false,
                message: `Cannot transition to ${targetPhase}:\n- ${validation.errors.join('\n- ')}`,
                errors: validation.errors,
                warnings: validation.warnings
            };
        }

        const currentPhase = await this.getCurrentPhase();

        // Execute pre-transition hooks
        await this.executeHooks('pre_transition', { from: currentPhase, to: targetPhase });

        // Update the manifest
        await this.manifest.updateMeta('Current Phase', targetPhase);
        
        // Add snapshot
        await this.manifest.addSnapshot(`Phase transition: ${currentPhase} → ${targetPhase}${notes ? ` (${notes})` : ''}`);

        // Execute post-transition hooks
        await this.executeHooks('post_transition', { from: currentPhase, to: targetPhase });

        return {
            success: true,
            message: `Successfully transitioned from ${currentPhase} to ${targetPhase}`,
            previousPhase: currentPhase,
            currentPhase: targetPhase,
            warnings: validation.warnings
        };
    }

    // Submit scope (Ideation → Scoping)
    async submitScope(scopeDocument) {
        const currentPhase = await this.getCurrentPhase();
        
        if (currentPhase !== PROJECT_PHASES.IDEATION) {
            return {
                success: false,
                message: `submit_scope can only be called in Ideation phase. Current: ${currentPhase}`
            };
        }

        // Validate scope document
        if (!scopeDocument || scopeDocument.length < 100) {
            return {
                success: false,
                message: 'Scope document must be at least 100 characters.'
            };
        }

        // Log decision
        await this.manifest.addDecision(
            'Scope document submitted',
            'Moving from Ideation to Scoping phase',
            'All deliverables and constraints'
        );

        return await this.transitionTo(PROJECT_PHASES.SCOPING, { notes: 'Scope submitted' });
    }

    // Approve scope (Scoping → Planning)
    async approveScope(feedback = '') {
        const currentPhase = await this.getCurrentPhase();
        
        if (currentPhase !== PROJECT_PHASES.SCOPING) {
            return {
                success: false,
                message: `approve_scope can only be called in Scoping phase. Current: ${currentPhase}`
            };
        }

        // Log decision
        await this.manifest.addDecision(
            'Scope approved',
            feedback || 'Scope review completed successfully',
            'Enables task planning'
        );

        return await this.transitionTo(PROJECT_PHASES.PLANNING, { notes: `Scope approved${feedback ? `: ${feedback}` : ''}` });
    }

    // Lock plan (Planning → Execution)
    async lockPlan() {
        const currentPhase = await this.getCurrentPhase();
        
        if (currentPhase !== PROJECT_PHASES.PLANNING) {
            return {
                success: false,
                message: `lock_plan can only be called in Planning phase. Current: ${currentPhase}`
            };
        }

        // Log decision
        await this.manifest.addDecision(
            'Plan locked',
            'Task breakdown complete, assignments done',
            'Execution begins'
        );

        return await this.transitionTo(PROJECT_PHASES.EXECUTION, { notes: 'Plan locked' });
    }

    // Submit review (Execution → Review)
    async submitReview(reviewNotes = '') {
        const currentPhase = await this.getCurrentPhase();
        
        if (currentPhase !== PROJECT_PHASES.EXECUTION) {
            return {
                success: false,
                message: `submit_review can only be called in Execution phase. Current: ${currentPhase}`
            };
        }

        // Log decision
        await this.manifest.addDecision(
            'Review submitted',
            reviewNotes || 'Execution complete, ready for review',
            'All deliverables'
        );

        return await this.transitionTo(PROJECT_PHASES.REVIEW, { notes: reviewNotes || 'Review submitted' });
    }

    // Close project (Review → Closure)
    async closeProject(retrospective = '') {
        const currentPhase = await this.getCurrentPhase();
        
        if (currentPhase !== PROJECT_PHASES.REVIEW) {
            return {
                success: false,
                message: `close_project can only be called in Review phase. Current: ${currentPhase}`
            };
        }

        // Update project status
        await this.manifest.updateMeta('Status', PROJECT_STATUS.COMPLETED);

        // Log decision
        await this.manifest.addDecision(
            'Project closed',
            retrospective || 'Project completed successfully',
            'Project archived'
        );

        return await this.transitionTo(PROJECT_PHASES.CLOSURE, { notes: retrospective || 'Project closed' });
    }

    // Pause project
    async pauseProject(reason = '') {
        await this.manifest.updateMeta('Status', PROJECT_STATUS.PAUSED);
        await this.manifest.addSnapshot(`Project paused: ${reason || 'No reason provided'}`);

        return {
            success: true,
            message: `Project paused${reason ? `: ${reason}` : ''}`
        };
    }

    // Resume project
    async resumeProject() {
        await this.manifest.updateMeta('Status', PROJECT_STATUS.ACTIVE);
        await this.manifest.addSnapshot('Project resumed');

        return {
            success: true,
            message: 'Project resumed'
        };
    }

    // Archive project
    async archiveProject() {
        await this.manifest.updateMeta('Status', PROJECT_STATUS.ARCHIVED);
        await this.manifest.addSnapshot('Project archived');

        return {
            success: true,
            message: 'Project archived'
        };
    }

    // Get phase progress report
    async getProgressReport() {
        const parsed = await this.manifest.parseManifest();
        if (!parsed) return null;

        const currentPhase = parsed.meta?.current_phase || PROJECT_PHASES.IDEATION;
        const phaseIndex = PHASE_ORDER.indexOf(currentPhase);

        const tasksTotal = parsed.tasks.length;
        const tasksDone = parsed.tasks.filter(t => t.status === TASK_STATUS.DONE).length;
        const tasksInProgress = parsed.tasks.filter(t => t.status === TASK_STATUS.IN_PROGRESS).length;
        const tasksBlocked = parsed.tasks.filter(t => t.status === TASK_STATUS.BLOCKED).length;

        const deliverablesTotal = parsed.deliverables.length;
        const deliverablesComplete = parsed.deliverables.filter(d => d.status === DELIVERABLE_STATUS.COMPLETED).length;

        const goalsTotal = parsed.goals.length;
        const goalsMet = parsed.goals.filter(g => g.status === 'Met' || g.status === 'Completed').length;

        const highRisks = parsed.risks.filter(r => r.impact === 'High' || r.probability === 'High').length;

        return {
            project: {
                id: parsed.meta?.id,
                name: parsed.meta?.name,
                type: parsed.meta?.type,
                status: parsed.meta?.status,
                owner: parsed.meta?.owner
            },
            phase: {
                current: currentPhase,
                index: phaseIndex,
                total: PHASE_ORDER.length,
                percentComplete: Math.round((phaseIndex / (PHASE_ORDER.length - 1)) * 100),
                nextPhases: this.getNextPhases(currentPhase)
            },
            tasks: {
                total: tasksTotal,
                done: tasksDone,
                inProgress: tasksInProgress,
                blocked: tasksBlocked,
                percentComplete: tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0
            },
            deliverables: {
                total: deliverablesTotal,
                complete: deliverablesComplete,
                percentComplete: deliverablesTotal > 0 ? Math.round((deliverablesComplete / deliverablesTotal) * 100) : 0
            },
            goals: {
                total: goalsTotal,
                met: goalsMet
            },
            risks: {
                total: parsed.risks.length,
                high: highRisks
            },
            nextAction: this.suggestNextAction(currentPhase, parsed)
        };
    }

    // Suggest next action based on current state
    suggestNextAction(phase, parsed) {
        switch (phase) {
            case PROJECT_PHASES.IDEATION:
                if (parsed.goals.length === 0) {
                    return 'Define at least one project goal using add_goal';
                }
                return 'Ready to submit scope document using submit_scope';

            case PROJECT_PHASES.SCOPING:
                if (parsed.deliverables.length === 0) {
                    return 'Define deliverables using add_deliverable';
                }
                return 'Ready to approve scope using approve_scope';

            case PROJECT_PHASES.PLANNING:
                if (parsed.tasks.length < 3) {
                    return 'Define at least 3 tasks using add_task';
                }
                const unassigned = parsed.tasks.filter(t => !t.assignee || t.assignee === '-');
                if (unassigned.length > 0) {
                    return `Assign ${unassigned.length} unassigned task(s)`;
                }
                return 'Ready to lock plan using lock_plan';

            case PROJECT_PHASES.EXECUTION:
                const incomplete = parsed.tasks.filter(t => t.status !== TASK_STATUS.DONE && t.status !== TASK_STATUS.CANCELLED);
                if (incomplete.length > 0) {
                    return `Complete ${incomplete.length} remaining task(s)`;
                }
                return 'Ready for review using submit_review';

            case PROJECT_PHASES.REVIEW:
                const pending = parsed.deliverables.filter(d => d.status !== DELIVERABLE_STATUS.COMPLETED);
                if (pending.length > 0) {
                    return `Review ${pending.length} pending deliverable(s)`;
                }
                return 'Ready to close project using close_project';

            case PROJECT_PHASES.CLOSURE:
                return 'Project is closed. Archive when ready.';

            default:
                return 'Unknown phase';
        }
    }
}
