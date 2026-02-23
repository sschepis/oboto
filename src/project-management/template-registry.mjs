// Template Registry
// Provides pre-defined project templates for different project types
// Templates define default phases, deliverables, tasks, and constraints

import { PROJECT_PHASES, PROJECT_TYPES, DELIVERABLE_STATUS } from './project-manifest.mjs';

/**
 * @typedef {Object} ProjectTemplate
 * @property {string} id - Template ID
 * @property {string} name - Template name
 * @property {string} type - Project type
 * @property {string} description - Template description
 * @property {string[]} phases - Custom phases (if different from default)
 * @property {Object[]} defaultDeliverables - Default deliverables to create
 * @property {Object[]} defaultConstraints - Default constraints
 * @property {Object[]} suggestedRisks - Common risks for this project type
 * @property {Object} metadata - Additional template metadata
 */

// Built-in project templates
const TEMPLATES = {
    // Software Development Project
    software: {
        id: 'software',
        name: 'Software Development',
        type: PROJECT_TYPES.SOFTWARE,
        description: 'Full software development lifecycle with design, implementation, testing, and deployment phases.',
        phases: [
            PROJECT_PHASES.IDEATION,
            'Requirements',
            'Design',
            PROJECT_PHASES.PLANNING,
            PROJECT_PHASES.EXECUTION,
            'Testing',
            PROJECT_PHASES.REVIEW,
            'Deployment',
            PROJECT_PHASES.CLOSURE
        ],
        defaultDeliverables: [
            { name: 'Requirements Document', phase: 'Requirements', owner: '@product' },
            { name: 'Technical Design', phase: 'Design', owner: '@architect' },
            { name: 'Source Code', phase: 'Execution', owner: '@dev' },
            { name: 'Test Suite', phase: 'Testing', owner: '@qa' },
            { name: 'Documentation', phase: 'Review', owner: '@docs' },
            { name: 'Deployment Package', phase: 'Deployment', owner: '@devops' }
        ],
        defaultConstraints: [
            { name: 'Code Coverage', type: 'Hard', description: 'Minimum 80% test coverage required' },
            { name: 'Performance', type: 'Hard', description: 'Response time < 200ms for P95' },
            { name: 'Security', type: 'Hard', description: 'Must pass OWASP Top 10 security audit' }
        ],
        suggestedRisks: [
            { name: 'Scope creep', probability: 'High', impact: 'Medium', mitigation: 'Weekly scope reviews' },
            { name: 'Technical debt', probability: 'Medium', impact: 'High', mitigation: 'Regular refactoring sprints' },
            { name: 'Integration issues', probability: 'Medium', impact: 'High', mitigation: 'Continuous integration' }
        ],
        metadata: {
            estimatedDuration: '3-6 months',
            teamSize: '3-10',
            methodology: 'Agile/Scrum'
        }
    },

    // Creative/Content Project
    creative: {
        id: 'creative',
        name: 'Creative/Content',
        type: PROJECT_TYPES.CREATIVE,
        description: 'Content creation project with ideation, drafting, review, and publication phases.',
        phases: [
            PROJECT_PHASES.IDEATION,
            'Research',
            'Outline',
            'Draft',
            'Edit',
            PROJECT_PHASES.REVIEW,
            'Publish',
            PROJECT_PHASES.CLOSURE
        ],
        defaultDeliverables: [
            { name: 'Creative Brief', phase: 'Ideation', owner: '@creative' },
            { name: 'Research Notes', phase: 'Research', owner: '@researcher' },
            { name: 'Content Outline', phase: 'Outline', owner: '@writer' },
            { name: 'First Draft', phase: 'Draft', owner: '@writer' },
            { name: 'Final Draft', phase: 'Edit', owner: '@editor' },
            { name: 'Published Content', phase: 'Publish', owner: '@publisher' }
        ],
        defaultConstraints: [
            { name: 'Brand Guidelines', type: 'Hard', description: 'Must follow brand voice and style guide' },
            { name: 'Word Count', type: 'Soft', description: 'Target 1000-2000 words per piece' },
            { name: 'SEO Requirements', type: 'Soft', description: 'Include target keywords naturally' }
        ],
        suggestedRisks: [
            { name: 'Creative block', probability: 'Medium', impact: 'Medium', mitigation: 'Buffer time in schedule' },
            { name: 'Stakeholder feedback delays', probability: 'High', impact: 'Medium', mitigation: 'Set review deadlines' },
            { name: 'Scope changes', probability: 'High', impact: 'Low', mitigation: 'Version control on briefs' }
        ],
        metadata: {
            estimatedDuration: '2-4 weeks',
            teamSize: '1-5',
            methodology: 'Kanban'
        }
    },

    // Research Project
    research: {
        id: 'research',
        name: 'Research',
        type: PROJECT_TYPES.RESEARCH,
        description: 'Research project with hypothesis formation, data collection, analysis, and reporting.',
        phases: [
            PROJECT_PHASES.IDEATION,
            'Hypothesis',
            'Literature Review',
            'Methodology',
            'Data Collection',
            'Analysis',
            PROJECT_PHASES.REVIEW,
            'Publication',
            PROJECT_PHASES.CLOSURE
        ],
        defaultDeliverables: [
            { name: 'Research Proposal', phase: 'Ideation', owner: '@researcher' },
            { name: 'Literature Review', phase: 'Literature Review', owner: '@researcher' },
            { name: 'Methodology Document', phase: 'Methodology', owner: '@researcher' },
            { name: 'Raw Data', phase: 'Data Collection', owner: '@researcher' },
            { name: 'Analysis Report', phase: 'Analysis', owner: '@analyst' },
            { name: 'Final Paper', phase: 'Publication', owner: '@researcher' }
        ],
        defaultConstraints: [
            { name: 'Ethics Approval', type: 'Hard', description: 'IRB approval required before data collection' },
            { name: 'Sample Size', type: 'Hard', description: 'Minimum N=30 for statistical significance' },
            { name: 'Citation Format', type: 'Soft', description: 'APA 7th edition format' }
        ],
        suggestedRisks: [
            { name: 'Insufficient data', probability: 'Medium', impact: 'High', mitigation: 'Pilot study first' },
            { name: 'Hypothesis rejection', probability: 'Medium', impact: 'Medium', mitigation: 'Document negative results' },
            { name: 'Reproducibility issues', probability: 'Low', impact: 'High', mitigation: 'Document methodology thoroughly' }
        ],
        metadata: {
            estimatedDuration: '3-12 months',
            teamSize: '1-5',
            methodology: 'Scientific Method'
        }
    },

    // Event Planning
    event: {
        id: 'event',
        name: 'Event Planning',
        type: PROJECT_TYPES.EVENT,
        description: 'Event planning from concept to execution with venue, speakers, and logistics.',
        phases: [
            PROJECT_PHASES.IDEATION,
            'Venue Selection',
            'Speaker/Content',
            'Marketing',
            'Logistics',
            PROJECT_PHASES.EXECUTION,
            'Event Day',
            PROJECT_PHASES.REVIEW,
            PROJECT_PHASES.CLOSURE
        ],
        defaultDeliverables: [
            { name: 'Event Concept', phase: 'Ideation', owner: '@planner' },
            { name: 'Venue Contract', phase: 'Venue Selection', owner: '@planner' },
            { name: 'Speaker Lineup', phase: 'Speaker/Content', owner: '@content' },
            { name: 'Marketing Materials', phase: 'Marketing', owner: '@marketing' },
            { name: 'Logistics Plan', phase: 'Logistics', owner: '@operations' },
            { name: 'Event Report', phase: 'Review', owner: '@planner' }
        ],
        defaultConstraints: [
            { name: 'Budget', type: 'Hard', description: 'Must stay within approved budget' },
            { name: 'Capacity', type: 'Hard', description: 'Cannot exceed venue capacity' },
            { name: 'Accessibility', type: 'Hard', description: 'Venue must be ADA compliant' }
        ],
        suggestedRisks: [
            { name: 'Low attendance', probability: 'Medium', impact: 'High', mitigation: 'Early bird registration' },
            { name: 'Speaker cancellation', probability: 'Medium', impact: 'Medium', mitigation: 'Backup speakers list' },
            { name: 'Weather (outdoor)', probability: 'Low', impact: 'High', mitigation: 'Indoor backup plan' }
        ],
        metadata: {
            estimatedDuration: '2-6 months',
            teamSize: '3-15',
            methodology: 'Milestone-based'
        }
    },

    // Operational/Process Improvement
    operational: {
        id: 'operational',
        name: 'Operational/Process',
        type: PROJECT_TYPES.OPERATIONAL,
        description: 'Continuous operational improvement with metrics tracking and iterative optimization.',
        phases: [
            PROJECT_PHASES.IDEATION,
            'Baseline',
            'Analysis',
            PROJECT_PHASES.PLANNING,
            'Pilot',
            PROJECT_PHASES.EXECUTION,
            'Measurement',
            PROJECT_PHASES.REVIEW,
            PROJECT_PHASES.CLOSURE
        ],
        defaultDeliverables: [
            { name: 'Current State Assessment', phase: 'Baseline', owner: '@analyst' },
            { name: 'Gap Analysis', phase: 'Analysis', owner: '@analyst' },
            { name: 'Improvement Plan', phase: 'Planning', owner: '@manager' },
            { name: 'Pilot Results', phase: 'Pilot', owner: '@lead' },
            { name: 'SOP Updates', phase: 'Execution', owner: '@ops' },
            { name: 'Performance Report', phase: 'Measurement', owner: '@analyst' }
        ],
        defaultConstraints: [
            { name: 'No Service Disruption', type: 'Hard', description: 'Changes must not disrupt current operations' },
            { name: 'ROI Target', type: 'Hard', description: 'Must achieve 20% efficiency improvement' },
            { name: 'Change Window', type: 'Soft', description: 'Major changes during off-peak hours only' }
        ],
        suggestedRisks: [
            { name: 'Resistance to change', probability: 'High', impact: 'Medium', mitigation: 'Change management training' },
            { name: 'Process dependencies', probability: 'Medium', impact: 'High', mitigation: 'Dependency mapping' },
            { name: 'Measurement errors', probability: 'Low', impact: 'Medium', mitigation: 'Automated metrics' }
        ],
        metadata: {
            estimatedDuration: '1-3 months',
            teamSize: '2-8',
            methodology: 'Lean/Six Sigma'
        }
    },

    // Simple/General Project
    general: {
        id: 'general',
        name: 'General Project',
        type: PROJECT_TYPES.GENERAL,
        description: 'Basic project template with standard lifecycle phases.',
        phases: [
            PROJECT_PHASES.IDEATION,
            PROJECT_PHASES.SCOPING,
            PROJECT_PHASES.PLANNING,
            PROJECT_PHASES.EXECUTION,
            PROJECT_PHASES.REVIEW,
            PROJECT_PHASES.CLOSURE
        ],
        defaultDeliverables: [
            { name: 'Project Charter', phase: 'Ideation', owner: '@user' },
            { name: 'Scope Document', phase: 'Scoping', owner: '@user' },
            { name: 'Project Plan', phase: 'Planning', owner: '@user' },
            { name: 'Final Deliverable', phase: 'Execution', owner: '@user' }
        ],
        defaultConstraints: [
            { name: 'Timeline', type: 'Soft', description: 'Target completion date' },
            { name: 'Budget', type: 'Soft', description: 'Stay within allocated resources' }
        ],
        suggestedRisks: [
            { name: 'Scope creep', probability: 'Medium', impact: 'Medium', mitigation: 'Regular scope reviews' },
            { name: 'Resource availability', probability: 'Medium', impact: 'Medium', mitigation: 'Resource planning' }
        ],
        metadata: {
            estimatedDuration: 'Variable',
            teamSize: '1-10',
            methodology: 'Flexible'
        }
    }
};

export class TemplateRegistry {
    constructor(projectManifest) {
        this.manifest = projectManifest;
        this.customTemplates = new Map();
    }

    // List all available templates
    listTemplates() {
        const builtIn = Object.values(TEMPLATES).map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
            description: t.description,
            isBuiltIn: true
        }));

        const custom = [...this.customTemplates.values()].map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
            description: t.description,
            isBuiltIn: false
        }));

        return [...builtIn, ...custom];
    }

    // Get a template by ID
    getTemplate(templateId) {
        return TEMPLATES[templateId] || this.customTemplates.get(templateId) || null;
    }

    // Register a custom template
    registerTemplate(template) {
        if (!template.id || !template.name) {
            return { success: false, message: 'Template must have id and name' };
        }

        if (TEMPLATES[template.id]) {
            return { success: false, message: `Cannot override built-in template: ${template.id}` };
        }

        // Fill in defaults
        const fullTemplate = {
            type: PROJECT_TYPES.GENERAL,
            description: '',
            phases: Object.values(PROJECT_PHASES),
            defaultDeliverables: [],
            defaultConstraints: [],
            suggestedRisks: [],
            metadata: {},
            ...template
        };

        this.customTemplates.set(template.id, fullTemplate);

        return { success: true, message: `Template ${template.id} registered` };
    }

    // Remove a custom template
    removeTemplate(templateId) {
        if (TEMPLATES[templateId]) {
            return { success: false, message: `Cannot remove built-in template: ${templateId}` };
        }

        if (this.customTemplates.delete(templateId)) {
            return { success: true, message: `Template ${templateId} removed` };
        }

        return { success: false, message: `Template ${templateId} not found` };
    }

    // Apply a template to the current project
    async applyTemplate(templateId, options = {}) {
        const template = this.getTemplate(templateId);
        if (!template) {
            return { success: false, message: `Template ${templateId} not found` };
        }

        const {
            includeDeliverables = true,
            includeConstraints = true,
            includeRisks = true,
            defaultOwner = '@user'
        } = options;

        const results = {
            deliverables: [],
            constraints: [],
            risks: []
        };

        // Add default deliverables
        if (includeDeliverables && template.defaultDeliverables) {
            for (const del of template.defaultDeliverables) {
                const result = await this.manifest.addDeliverable(
                    null,
                    del.name,
                    del.owner || defaultOwner,
                    del.phase,
                    DELIVERABLE_STATUS.NOT_STARTED,
                    del.dependencies || '-'
                );
                results.deliverables.push(result.id);
            }
        }

        // Add default constraints
        if (includeConstraints && template.defaultConstraints) {
            for (const constraint of template.defaultConstraints) {
                const result = await this.manifest.addConstraint(
                    null,
                    constraint.name,
                    constraint.type,
                    constraint.description
                );
                results.constraints.push(result.id);
            }
        }

        // Add suggested risks
        if (includeRisks && template.suggestedRisks) {
            for (const risk of template.suggestedRisks) {
                const result = await this.manifest.addRisk(
                    null,
                    risk.name,
                    risk.probability,
                    risk.impact,
                    risk.mitigation,
                    defaultOwner
                );
                results.risks.push(result.id);
            }
        }

        // Update project type in meta
        await this.manifest.updateMeta('Type', template.type);

        // Add snapshot
        await this.manifest.addSnapshot(`Applied template: ${template.name}`);

        return {
            success: true,
            message: `Template "${template.name}" applied successfully`,
            template: templateId,
            created: {
                deliverables: results.deliverables.length,
                constraints: results.constraints.length,
                risks: results.risks.length
            },
            results
        };
    }

    // Get template suggestions based on project description
    suggestTemplates(description) {
        const descLower = description.toLowerCase();
        const scores = [];

        const keywords = {
            software: ['code', 'software', 'app', 'application', 'api', 'website', 'platform', 'system', 'develop', 'programming', 'bug', 'feature'],
            creative: ['content', 'article', 'blog', 'video', 'design', 'creative', 'write', 'copy', 'brand', 'marketing', 'campaign'],
            research: ['research', 'study', 'analysis', 'data', 'survey', 'hypothesis', 'experiment', 'paper', 'academic', 'findings'],
            event: ['event', 'conference', 'meeting', 'workshop', 'webinar', 'seminar', 'venue', 'attendee', 'speaker', 'schedule'],
            operational: ['process', 'operation', 'efficiency', 'workflow', 'automation', 'optimize', 'improve', 'sop', 'procedure']
        };

        for (const [templateId, templateKeywords] of Object.entries(keywords)) {
            let score = 0;
            for (const kw of templateKeywords) {
                if (descLower.includes(kw)) {
                    score++;
                }
            }
            if (score > 0) {
                scores.push({ templateId, score, template: TEMPLATES[templateId] });
            }
        }

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        // If no matches, suggest general
        if (scores.length === 0) {
            return [{
                templateId: 'general',
                score: 0,
                template: TEMPLATES.general,
                reason: 'Default template for general projects'
            }];
        }

        return scores.map(s => ({
            ...s,
            reason: `Matched ${s.score} keyword(s) for ${s.template.name}`
        }));
    }

    // Create a new project from template
    async createFromTemplate(projectName, templateId, options = {}) {
        const template = this.getTemplate(templateId);
        if (!template) {
            return { success: false, message: `Template ${templateId} not found` };
        }

        // Initialize the project
        const initResult = await this.manifest.initManifest(
            projectName,
            template.type,
            options.owner || '@user'
        );

        if (!initResult.success) {
            return initResult;
        }

        // Apply the template
        const applyResult = await this.applyTemplate(templateId, options);

        return {
            success: true,
            message: `Project "${projectName}" created from template "${template.name}"`,
            projectId: initResult.projectId,
            template: templateId,
            ...applyResult
        };
    }

    // Export template as JSON
    exportTemplate(templateId) {
        const template = this.getTemplate(templateId);
        if (!template) {
            return null;
        }

        return JSON.stringify(template, null, 2);
    }

    // Import template from JSON
    importTemplate(jsonString) {
        try {
            const template = JSON.parse(jsonString);
            return this.registerTemplate(template);
        } catch (error) {
            return { success: false, message: `Invalid JSON: ${error.message}` };
        }
    }

    // Get template phases
    getTemplatePhases(templateId) {
        const template = this.getTemplate(templateId);
        if (!template) return null;

        return template.phases;
    }

    // Get template metadata
    getTemplateMetadata(templateId) {
        const template = this.getTemplate(templateId);
        if (!template) return null;

        return {
            id: template.id,
            name: template.name,
            type: template.type,
            description: template.description,
            phases: template.phases,
            deliverablesCount: template.defaultDeliverables?.length || 0,
            constraintsCount: template.defaultConstraints?.length || 0,
            risksCount: template.suggestedRisks?.length || 0,
            ...template.metadata
        };
    }
}

// Export built-in templates for reference
export const BUILT_IN_TEMPLATES = TEMPLATES;
