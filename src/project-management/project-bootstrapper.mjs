// Project Bootstrapper (Project Management)
// Discovers existing project documentation and bootstraps PROJECT_MAP.md
// Refactored to extend BaseBootstrapper (see docs/DUPLICATE_CODE_ANALYSIS.md — DUP-1)

import fs from 'fs';
import path from 'path';
import { PROJECT_PHASES, PROJECT_TYPES, DELIVERABLE_STATUS } from './project-manifest.mjs';
import { BaseBootstrapper } from '../lib/base-bootstrapper.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

// Files to search for existing project documentation
const PROJECT_DOC_CANDIDATES = [
    'PROJECT.md',
    'DESIGN.md',
    'ARCHITECTURE.md',
    'PLAN.md',
    'SPEC.md',
    'REQUIREMENTS.md',
    'README.md'
];

// Keywords for detecting project type
const TYPE_KEYWORDS = {
    [PROJECT_TYPES.SOFTWARE]: [
        'code', 'software', 'api', 'database', 'frontend', 'backend',
        'deploy', 'test', 'function', 'class', 'module', 'npm', 'git'
    ],
    [PROJECT_TYPES.CREATIVE]: [
        'content', 'article', 'design', 'brand', 'copy', 'video',
        'image', 'creative', 'write', 'publish', 'media'
    ],
    [PROJECT_TYPES.RESEARCH]: [
        'research', 'study', 'analysis', 'data', 'hypothesis',
        'experiment', 'survey', 'findings', 'methodology'
    ],
    [PROJECT_TYPES.EVENT]: [
        'event', 'conference', 'meeting', 'venue', 'speaker',
        'attendee', 'schedule', 'agenda', 'registration'
    ],
    [PROJECT_TYPES.OPERATIONAL]: [
        'process', 'workflow', 'automation', 'efficiency',
        'sop', 'procedure', 'optimize', 'metrics'
    ]
};

// Keywords indicating deliverables
const DELIVERABLE_KEYWORDS = [
    'deliverable', 'output', 'artifact', 'document', 'report',
    'design', 'implementation', 'prototype', 'mvp', 'release',
    'specification', 'requirements', 'test', 'documentation'
];

// Keywords indicating goals/objectives
const GOAL_KEYWORDS = [
    'goal', 'objective', 'target', 'kpi', 'metric', 'success',
    'outcome', 'result', 'achieve', 'accomplish', 'milestone'
];

// Keywords indicating constraints
const CONSTRAINT_KEYWORDS = [
    'constraint', 'limitation', 'requirement', 'must', 'shall',
    'budget', 'timeline', 'deadline', 'scope', 'restriction'
];

// Keywords indicating risks
const RISK_KEYWORDS = [
    'risk', 'threat', 'issue', 'concern', 'challenge',
    'blocker', 'dependency', 'assumption'
];

export class ProjectBootstrapper extends BaseBootstrapper {
    constructor(projectManifest) {
        super(projectManifest, {
            docCandidates: PROJECT_DOC_CANDIDATES,
            manifestFilename: 'PROJECT_MAP.md'
        });
    }

    /**
     * Main entry point - bootstrap a project from existing docs
     * @param {string} targetDir - Directory to bootstrap
     * @returns {{ bootstrapped: boolean, message: string }}
     */
    async bootstrap(targetDir) {
        const dir = targetDir || this.manifest.workingDir;

        if (!fs.existsSync(dir)) {
            return {
                bootstrapped: false,
                message: `Directory not found: ${dir}`
            };
        }

        // Check if manifest already exists
        const manifestPath = path.join(dir, 'PROJECT_MAP.md');
        if (fs.existsSync(manifestPath)) {
            return {
                bootstrapped: false,
                message: 'PROJECT_MAP.md already exists. Use existing manifest or delete to re-bootstrap.'
            };
        }

        // Find project documentation
        const docPath = this.findDocFile(dir);
        if (!docPath) {
            return {
                bootstrapped: false,
                message: 'No project documentation found. Will create empty manifest.'
            };
        }

        consoleStyler.log('system', `Found project documentation: ${path.basename(docPath)}`);

        // Read and parse the document
        let content;
        try {
            content = await fs.promises.readFile(docPath, 'utf8');
        } catch (error) {
            return {
                bootstrapped: false,
                message: `Error reading document: ${error.message}`
            };
        }

        if (!content || content.trim().length < 50) {
            return {
                bootstrapped: false,
                message: 'Document too short to extract project information.'
            };
        }

        // Parse the document
        const parsed = this.parseDocument(content);

        // Extract project metadata
        const projectName = this.extractProjectName(parsed, docPath);
        const projectType = this.detectProjectType(content);
        const goals = this.extractGoals(parsed);
        const deliverables = this.extractDeliverables(parsed);
        const constraints = this.extractConstraints(parsed);
        const risks = this.extractRisks(parsed);

        // Save original working dir
        const originalWorkingDir = this.manifest.workingDir;
        const originalManifestPath = this.manifest.manifestPath;
        const originalSnapshotsDir = this.manifest.snapshotsDir;
        const originalProjectDir = this.manifest.projectDir;

        try {
            // Override paths for target directory
            this.manifest.workingDir = dir;
            this.manifest.manifestPath = manifestPath;
            this.manifest.snapshotsDir = path.join(dir, '.project-snapshots');
            this.manifest.projectDir = path.join(dir, '.project');

            // Initialize manifest
            const initResult = await this.manifest.initManifest(
                projectName,
                projectType,
                '@user'
            );

            if (!initResult.success) {
                return { bootstrapped: false, message: initResult.message };
            }

            // Add extracted items
            for (const goal of goals) {
                await this.manifest.addGoal(null, goal.goal, goal.metric, goal.target, 'Not Started');
            }

            for (const del of deliverables) {
                await this.manifest.addDeliverable(
                    null,
                    del.name,
                    '@user',
                    del.phase || PROJECT_PHASES.EXECUTION,
                    DELIVERABLE_STATUS.NOT_STARTED,
                    '-'
                );
            }

            for (const con of constraints) {
                await this.manifest.addConstraint(null, con.name, con.type, con.description);
            }

            for (const risk of risks) {
                await this.manifest.addRisk(
                    null,
                    risk.name,
                    risk.probability || 'Medium',
                    risk.impact || 'Medium',
                    risk.mitigation || 'To be determined',
                    '@user'
                );
            }

            // Add snapshot
            await this.manifest.addSnapshot(`Bootstrapped from ${path.basename(docPath)}`);

            return {
                bootstrapped: true,
                message: `Project bootstrapped from ${path.basename(docPath)}`,
                projectName,
                projectType,
                extracted: {
                    goals: goals.length,
                    deliverables: deliverables.length,
                    constraints: constraints.length,
                    risks: risks.length
                }
            };

        } finally {
            // Restore original paths
            this.manifest.workingDir = originalWorkingDir;
            this.manifest.manifestPath = originalManifestPath;
            this.manifest.snapshotsDir = originalSnapshotsDir;
            this.manifest.projectDir = originalProjectDir;
        }
    }

    /**
     * Extract project name from parsed document or filename
     */
    extractProjectName(parsed, docPath) {
        if (parsed.title && !parsed.title.toLowerCase().includes('readme')) {
            return parsed.title;
        }

        const nameMatch = parsed.rawContent.match(/(?:project|name):\s*(.+)/i);
        if (nameMatch) {
            return nameMatch[1].trim();
        }

        return path.basename(path.dirname(docPath));
    }

    /**
     * Detect project type from content
     */
    detectProjectType(content) {
        const contentLower = content.toLowerCase();
        const scores = {};

        for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
            scores[type] = 0;
            for (const kw of keywords) {
                const regex = new RegExp(`\\b${kw}\\b`, 'gi');
                const matches = contentLower.match(regex);
                if (matches) {
                    scores[type] += matches.length;
                }
            }
        }

        let maxType = PROJECT_TYPES.GENERAL;
        let maxScore = 0;

        for (const [type, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                maxType = type;
            }
        }

        return maxScore >= 3 ? maxType : PROJECT_TYPES.GENERAL;
    }

    /**
     * Extract goals from document
     */
    extractGoals(parsed) {
        const goals = [];

        for (const section of parsed.sections) {
            const headingLower = section.heading.toLowerCase();
            const isGoalSection = GOAL_KEYWORDS.some(kw => headingLower.includes(kw));

            if (isGoalSection) {
                const bullets = this.extractBullets(section.content, { minLength: 5 });
                for (const bullet of bullets) {
                    goals.push({
                        goal: bullet.text,
                        metric: 'Completion',
                        target: '100%'
                    });
                }
            }
        }

        // Also check for inline goals
        const goalPatterns = [
            /goal:\s*(.+)/gi,
            /objective:\s*(.+)/gi,
            /target:\s*(.+)/gi
        ];

        for (const pattern of goalPatterns) {
            const matches = parsed.rawContent.matchAll(pattern);
            for (const match of matches) {
                if (!goals.some(g => g.goal === match[1].trim())) {
                    goals.push({
                        goal: match[1].trim(),
                        metric: 'Completion',
                        target: '100%'
                    });
                }
            }
        }

        return goals.slice(0, 10);
    }

    /**
     * Extract deliverables from document
     */
    extractDeliverables(parsed) {
        const deliverables = [];

        for (const section of parsed.sections) {
            const headingLower = section.heading.toLowerCase();
            const isDeliverableSection = DELIVERABLE_KEYWORDS.some(kw => headingLower.includes(kw));

            if (isDeliverableSection) {
                const bullets = this.extractBullets(section.content, { minLength: 5 });
                for (const bullet of bullets) {
                    deliverables.push({
                        name: bullet.text,
                        phase: this.inferPhase(bullet.text)
                    });
                }
            }

            if (section.level >= 3 && DELIVERABLE_KEYWORDS.some(kw => headingLower.includes(kw))) {
                deliverables.push({
                    name: section.heading,
                    phase: this.inferPhase(section.heading)
                });
            }
        }

        return deliverables.slice(0, 15);
    }

    /**
     * Extract constraints from document
     */
    extractConstraints(parsed) {
        const constraints = [];

        for (const section of parsed.sections) {
            const headingLower = section.heading.toLowerCase();
            const isConstraintSection = CONSTRAINT_KEYWORDS.some(kw => headingLower.includes(kw));

            if (isConstraintSection) {
                const bullets = this.extractBullets(section.content, { minLength: 5 });
                for (const bullet of bullets) {
                    constraints.push({
                        name: bullet.text.substring(0, 30),
                        type: this.inferConstraintType(bullet.text),
                        description: bullet.text
                    });
                }
            }
        }

        // Look for inline constraints
        const constraintPatterns = [
            /must\s+(.+?)(?:\.|$)/gi,
            /shall\s+(.+?)(?:\.|$)/gi,
            /required:\s*(.+)/gi
        ];

        for (const pattern of constraintPatterns) {
            const matches = parsed.rawContent.matchAll(pattern);
            for (const match of matches) {
                const text = match[1].trim();
                if (text.length > 10 && text.length < 200) {
                    constraints.push({
                        name: text.substring(0, 30),
                        type: 'Hard',
                        description: text
                    });
                }
            }
        }

        return this.deduplicate(constraints).slice(0, 10);
    }

    /**
     * Extract risks from document
     */
    extractRisks(parsed) {
        const risks = [];

        for (const section of parsed.sections) {
            const headingLower = section.heading.toLowerCase();
            const isRiskSection = RISK_KEYWORDS.some(kw => headingLower.includes(kw));

            if (isRiskSection) {
                const bullets = this.extractBullets(section.content, { minLength: 5 });
                for (const bullet of bullets) {
                    risks.push({
                        name: bullet.text,
                        probability: 'Medium',
                        impact: 'Medium',
                        mitigation: 'To be determined'
                    });
                }
            }
        }

        return risks.slice(0, 10);
    }

    /**
     * Infer which phase a deliverable belongs to
     */
    inferPhase(text) {
        const textLower = text.toLowerCase();

        if (/requirement|spec|research|analysis/.test(textLower)) {
            return PROJECT_PHASES.SCOPING;
        }
        if (/plan|design|architecture/.test(textLower)) {
            return PROJECT_PHASES.PLANNING;
        }
        if (/implement|develop|build|create|code/.test(textLower)) {
            return PROJECT_PHASES.EXECUTION;
        }
        if (/test|review|verify|validate/.test(textLower)) {
            return PROJECT_PHASES.REVIEW;
        }
        if (/deploy|release|launch|publish/.test(textLower)) {
            return PROJECT_PHASES.CLOSURE;
        }

        return PROJECT_PHASES.EXECUTION;
    }

    /**
     * Infer constraint type
     */
    inferConstraintType(text) {
        const textLower = text.toLowerCase();

        if (/must|required|mandatory|essential|critical/.test(textLower)) {
            return 'Hard';
        }
        if (/should|preferred|nice to have|optional/.test(textLower)) {
            return 'Soft';
        }

        return 'Hard';
    }
}
