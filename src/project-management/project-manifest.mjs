// Project Manifest Manager
// Handles the creation, reading, and updating of PROJECT_MAP.md
// Generalized version of ManifestManager for any project type
// Refactored to extend BaseManifest (see docs/DUPLICATE_CODE_ANALYSIS.md — DUP-2)

import fs from 'fs';
import path from 'path';
import { BaseManifest } from '../lib/base-manifest.mjs';

/**
 * @typedef {Object} ProjectMeta
 * @property {string} id - Project ID (e.g., PROJ-001)
 * @property {string} name - Project name
 * @property {string} type - Project type (Software, Creative, Research, Operational)
 * @property {string} status - Active, Paused, Completed, Archived
 * @property {string} phase - Current lifecycle phase
 * @property {string} owner - Project owner
 * @property {string} created - Creation timestamp
 * @property {string} updated - Last update timestamp
 */

/**
 * @typedef {Object} Goal
 * @property {string} id - Goal ID
 * @property {string} goal - Goal description
 * @property {string} metric - How to measure
 * @property {string} target - Target value
 * @property {string} status - Goal status
 */

/**
 * @typedef {Object} Constraint
 * @property {string} id - Constraint ID
 * @property {string} name - Constraint name
 * @property {string} type - Hard, Soft
 * @property {string} description - Description
 */

/**
 * @typedef {Object} Deliverable
 * @property {string} id - Deliverable ID
 * @property {string} name - Deliverable name
 * @property {string} owner - Owner
 * @property {string} phase - Target phase
 * @property {string} status - Status
 * @property {string[]} dependencies - Dependency IDs
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Task ID
 * @property {string} name - Task name
 * @property {string} deliverable - Associated deliverable ID
 * @property {string} assignee - Assignee
 * @property {string} status - Task status
 * @property {string} priority - Priority level
 */

/**
 * @typedef {Object} Risk
 * @property {string} id - Risk ID
 * @property {string} name - Risk description
 * @property {string} probability - Low, Medium, High
 * @property {string} impact - Low, Medium, High
 * @property {string} mitigation - Mitigation strategy
 * @property {string} owner - Risk owner
 */

// Project phases (generalized lifecycle)
export const PROJECT_PHASES = {
    IDEATION: 'Ideation',
    SCOPING: 'Scoping',
    PLANNING: 'Planning',
    EXECUTION: 'Execution',
    REVIEW: 'Review',
    CLOSURE: 'Closure'
};

// Phase order for transitions
export const PHASE_ORDER = [
    PROJECT_PHASES.IDEATION,
    PROJECT_PHASES.SCOPING,
    PROJECT_PHASES.PLANNING,
    PROJECT_PHASES.EXECUTION,
    PROJECT_PHASES.REVIEW,
    PROJECT_PHASES.CLOSURE
];

// Project types
export const PROJECT_TYPES = {
    SOFTWARE: 'Software',
    CREATIVE: 'Creative',
    RESEARCH: 'Research',
    OPERATIONAL: 'Operational',
    EVENT: 'Event',
    GENERAL: 'General'
};

// Status values
export const PROJECT_STATUS = {
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    COMPLETED: 'Completed',
    ARCHIVED: 'Archived'
};

export const DELIVERABLE_STATUS = {
    NOT_STARTED: 'Not Started',
    IN_PROGRESS: 'In Progress',
    COMPLETED: 'Completed',
    BLOCKED: 'Blocked',
    CANCELLED: 'Cancelled'
};

export const TASK_STATUS = {
    TODO: 'Todo',
    IN_PROGRESS: 'In Progress',
    DONE: 'Done',
    BLOCKED: 'Blocked',
    CANCELLED: 'Cancelled'
};

export class ProjectManifest extends BaseManifest {
    constructor(workingDir) {
        super(workingDir, 'PROJECT_MAP.md', '.project-snapshots');
        this.projectDir = path.join(workingDir, '.project');
    }

    // Initialize a new project manifest
    async initManifest(projectName, projectType = PROJECT_TYPES.GENERAL, owner = '@user') {
        if (this.hasManifest()) {
            return { success: false, message: 'Project manifest already exists.' };
        }

        // Create directories
        await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
        await fs.promises.mkdir(this.projectDir, { recursive: true });

        const projectId = this.generateId('PROJ');
        const now = new Date().toISOString();

        const template = `# Project Manifest (PROJECT_MAP.md)
Last Updated: ${now}

## 1. Project Meta
| Field | Value |
|-------|-------|
| ID | ${projectId} |
| Name | ${projectName} |
| Type | ${projectType} |
| Status | ${PROJECT_STATUS.ACTIVE} |
| Current Phase | ${PROJECT_PHASES.IDEATION} |
| Owner | ${owner} |
| Created | ${now} |

## 2. Goals & Success Criteria
| ID | Goal | Metric | Target | Status |
|---|---|---|---|---|

## 3. Constraints & Invariants
| ID | Constraint | Type | Description |
|---|---|---|---|

## 4. Deliverables Registry
| ID | Deliverable | Owner | Phase | Status | Dependencies |
|---|---|---|---|---|---|

## 5. Task Breakdown
| ID | Task | Deliverable | Assignee | Status | Priority |
|---|---|---|---|---|---|

## 6. Risk Registry
| ID | Risk | Probability | Impact | Mitigation | Owner |
|---|---|---|---|---|---|

## 7. Decision Log
| Date | Decision | Rationale | Impact |
|---|---|---|---|

## 8. State Snapshots
- [${now}] Project initialized: ${projectName}
`;

        try {
            await this.writeManifest(template);
            await this.createSnapshot('Initial project creation');

            // Create .cursorrules for project
            await this.createProjectRules();

            return {
                success: true,
                message: `Project "${projectName}" initialized with ID ${projectId}`,
                projectId,
                manifestPath: this.manifestPath
            };
        } catch (error) {
            return { success: false, message: `Failed to create manifest: ${error.message}` };
        }
    }

    // Create project-specific .cursorrules
    async createProjectRules() {
        const rulesPath = path.join(this.workingDir, '.cursorrules');
        
        // Don't overwrite existing rules, append project section
        let existingRules = '';
        try {
            existingRules = await fs.promises.readFile(rulesPath, 'utf8');
        } catch (e) {
            // File doesn't exist
        }

        const projectRules = `
# Project Management Rules

READ \`PROJECT_MAP.md\` BEFORE any project-related request.

## Project Phase Flow
1. **Ideation** → \`submit_scope\` → **Scoping**
2. **Scoping** → \`approve_scope\` → **Planning**
3. **Planning** → \`create_task_plan\` → \`lock_plan\` → **Execution**
4. **Execution** → \`checkpoint_progress\` → \`submit_review\` → **Review**
5. **Review** → \`close_project\` → **Closure**

## Rules
- Never skip phases without explicit user approval
- Update manifest after every significant action
- Log all major decisions in Decision Log
- Track risks proactively

## Tools
\`init_project\`, \`submit_scope\`, \`approve_scope\`, \`create_task_plan\`, \`lock_plan\`, \`checkpoint_progress\`, \`submit_review\`, \`close_project\`
`;

        if (!existingRules.includes('# Project Management Rules')) {
            const newRules = existingRules + '\n' + projectRules;
            await fs.promises.writeFile(rulesPath, newRules, 'utf8');
        }
    }

    // Parse manifest into structured data
    async parseManifest() {
        const content = await this.readManifest();
        if (!content) return null;

        const parsed = {
            meta: this.parseMetaSection(content),
            goals: this.parseTableSection(content, '## 2. Goals & Success Criteria'),
            constraints: this.parseTableSection(content, '## 3. Constraints & Invariants'),
            deliverables: this.parseTableSection(content, '## 4. Deliverables Registry'),
            tasks: this.parseTableSection(content, '## 5. Task Breakdown'),
            risks: this.parseTableSection(content, '## 6. Risk Registry'),
            decisions: this.parseTableSection(content, '## 7. Decision Log'),
            snapshots: this.parseSnapshotsSection(content)
        };

        return parsed;
    }

    // Parse the meta section (key-value table)
    parseMetaSection(content) {
        const metaMatch = content.match(/## 1. Project Meta([\s\S]*?)(?=## 2|$)/);
        if (!metaMatch) return {};

        const meta = {};
        const lines = metaMatch[1].split('\n').filter(l => l.trim().startsWith('|'));
        
        for (const line of lines) {
            const cols = line.split('|').map(c => c.trim()).filter(c => c);
            if (cols.length >= 2 && cols[0] !== 'Field' && !cols[0].includes('---')) {
                const key = cols[0].toLowerCase().replace(/\s+/g, '_');
                meta[key] = cols[1];
            }
        }

        return meta;
    }

    // Parse snapshots section
    parseSnapshotsSection(content) {
        const match = content.match(/## 8. State Snapshots([\s\S]*?)$/);
        if (!match) return [];

        const lines = match[1].trim().split('\n').filter(l => l.trim().startsWith('-'));
        return lines.map(l => l.replace(/^-\s*/, '').trim());
    }

    // Update project meta field
    async updateMeta(field, value) {
        const content = await this.readManifest();
        if (!content) return { success: false, message: 'Manifest not found.' };

        const fieldRegex = new RegExp(`(\\| ${field} \\|)[^|]*(\\|)`, 'i');
        
        if (fieldRegex.test(content)) {
            const newContent = content.replace(fieldRegex, `$1 ${value} $2`);
            await this.writeManifest(newContent);
            return { success: true, message: `Updated ${field} to ${value}` };
        }

        return { success: false, message: `Field '${field}' not found.` };
    }

    // Add or update a goal
    async addGoal(id, goal, metric, target, status = 'Not Started') {
        const parsed = await this.parseManifest();
        
        const goalId = id || this.generateId('GOAL');
        const goals = parsed.goals.filter(g => g.id !== goalId);
        goals.push({ id: goalId, goal, metric, target, status });

        const table = this.buildTable(
            ['ID', 'Goal', 'Metric', 'Target', 'Status'],
            goals.map(g => [g.id, g.goal, g.metric, g.target, g.status])
        );

        await this.updateSection('2. Goals & Success Criteria', table);
        return { success: true, id: goalId };
    }

    // Add or update a constraint
    async addConstraint(id, name, type, description) {
        const parsed = await this.parseManifest();
        
        const constId = id || this.generateId('CONST');
        const constraints = parsed.constraints.filter(c => c.id !== constId);
        constraints.push({ id: constId, constraint: name, type, description });

        const table = this.buildTable(
            ['ID', 'Constraint', 'Type', 'Description'],
            constraints.map(c => [c.id, c.constraint, c.type, c.description])
        );

        await this.updateSection('3. Constraints & Invariants', table);
        return { success: true, id: constId };
    }

    // Add or update a deliverable
    async addDeliverable(id, name, owner, phase, status = DELIVERABLE_STATUS.NOT_STARTED, dependencies = '-') {
        const parsed = await this.parseManifest();
        
        const delId = id || this.generateId('DEL');
        const deliverables = parsed.deliverables.filter(d => d.id !== delId);
        deliverables.push({ id: delId, deliverable: name, owner, phase, status, dependencies });

        const table = this.buildTable(
            ['ID', 'Deliverable', 'Owner', 'Phase', 'Status', 'Dependencies'],
            deliverables.map(d => [d.id, d.deliverable, d.owner, d.phase, d.status, d.dependencies])
        );

        await this.updateSection('4. Deliverables Registry', table);
        return { success: true, id: delId };
    }

    // Add or update a task
    async addTask(id, name, deliverable, assignee, status = TASK_STATUS.TODO, priority = 'Medium') {
        const parsed = await this.parseManifest();
        
        const taskId = id || this.generateId('TASK');
        const tasks = parsed.tasks.filter(t => t.id !== taskId);
        tasks.push({ id: taskId, task: name, deliverable, assignee, status, priority });

        const table = this.buildTable(
            ['ID', 'Task', 'Deliverable', 'Assignee', 'Status', 'Priority'],
            tasks.map(t => [t.id, t.task, t.deliverable, t.assignee, t.status, t.priority])
        );

        await this.updateSection('5. Task Breakdown', table);
        return { success: true, id: taskId };
    }

    // Add or update a risk
    async addRisk(id, name, probability, impact, mitigation, owner) {
        const parsed = await this.parseManifest();
        
        const riskId = id || this.generateId('RISK');
        const risks = parsed.risks.filter(r => r.id !== riskId);
        risks.push({ id: riskId, risk: name, probability, impact, mitigation, owner });

        const table = this.buildTable(
            ['ID', 'Risk', 'Probability', 'Impact', 'Mitigation', 'Owner'],
            risks.map(r => [r.id, r.risk, r.probability, r.impact, r.mitigation, r.owner])
        );

        await this.updateSection('6. Risk Registry', table);
        return { success: true, id: riskId };
    }

    // Add a decision
    async addDecision(decision, rationale, impact) {
        const parsed = await this.parseManifest();
        const date = new Date().toISOString().split('T')[0];
        
        const decisions = parsed.decisions || [];
        decisions.push({ date, decision, rationale, impact });

        const table = this.buildTable(
            ['Date', 'Decision', 'Rationale', 'Impact'],
            decisions.map(d => [d.date, d.decision, d.rationale, d.impact])
        );

        await this.updateSection('7. Decision Log', table);
        return { success: true };
    }

    // Add a snapshot entry (log line only, no file copy)
    async addSnapshot(message) {
        const content = await this.readManifest();
        const now = new Date().toISOString();
        const snapshotLine = `- [${now}] ${message}`;

        const newContent = content.replace(
            /(## 8. State Snapshots[\s\S]*?)$/,
            `$1${snapshotLine}\n`
        );

        await this.writeManifest(newContent);
    }

    // Get current phase
    async getCurrentPhase() {
        const parsed = await this.parseManifest();
        return parsed?.meta?.current_phase || PROJECT_PHASES.IDEATION;
    }

    // Get project completion percentage
    async getCompletionPercentage() {
        const parsed = await this.parseManifest();
        if (!parsed) return 0;

        const tasks = parsed.tasks;
        if (tasks.length === 0) return 0;

        const completed = tasks.filter(t => t.status === TASK_STATUS.DONE).length;
        return Math.round((completed / tasks.length) * 100);
    }
}
