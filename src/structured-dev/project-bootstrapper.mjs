// Project Bootstrapper (Structured Development)
// Discovers design documents and pre-populates SYSTEM_MAP.md
// Refactored to extend BaseBootstrapper (see docs/DUPLICATE_CODE_ANALYSIS.md — DUP-1)

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';
import { BaseBootstrapper } from '../lib/base-bootstrapper.mjs';

// Design file names to search for, in priority order
const DESIGN_FILE_CANDIDATES = ['DESIGN.md', 'ARCHITECTURE.md', 'README.md'];

// Keywords that indicate a heading describes a feature/component
const FEATURE_KEYWORDS = [
    'feature', 'module', 'component', 'system', 'service', 'api',
    'engine', 'manager', 'handler', 'layer', 'capability', 'subsystem',
    'pipeline', 'processor', 'controller', 'provider', 'adapter',
    'plugin', 'extension', 'tool', 'interface', 'endpoint'
];

// Section titles that typically list features
const FEATURE_SECTION_TITLES = [
    'features', 'components', 'architecture', 'modules', 'capabilities',
    'services', 'systems', 'subsystems', 'core modules', 'design',
    'system architecture', 'project structure', 'technical design'
];

// Keywords that indicate constraints/invariants
const INVARIANT_KEYWORDS = [
    'constraint', 'invariant', 'rule', 'requirement', 'limitation',
    'restriction', 'principle', 'guideline', 'non-functional',
    'security', 'performance', 'budget'
];

// Keywords that push phase toward "Interface"
const INTERFACE_KEYWORDS = [
    'interface', 'type ', 'schema', 'endpoint', 'signature',
    'contract', '.d.ts', 'typedef', 'api spec', 'openapi', 'graphql'
];

// Keywords that push phase toward "Design Review"
const DESIGN_REVIEW_KEYWORDS = [
    'edge case', 'complexity', 'o(n', 'o(1', 'o(log', 'trade-off',
    'tradeoff', 'constraint analysis', 'big-o', 'performance budget',
    'risk', 'mitigation', 'alternative', 'pros and cons'
];

export class ProjectBootstrapper extends BaseBootstrapper {
    constructor(manifestManager) {
        super(manifestManager, {
            docCandidates: DESIGN_FILE_CANDIDATES,
            manifestFilename: 'SYSTEM_MAP.md'
        });
        this.manifestManager = manifestManager;
    }

    /**
     * Main entry point. Bootstraps a project at targetDir.
     * Looks for a design file, parses it, and populates the manifest.
     * @param {string} targetDir - Directory to bootstrap
     * @returns {{ bootstrapped: boolean, message: string }}
     */
    async bootstrap(targetDir) {
        if (!fs.existsSync(targetDir)) {
            return {
                bootstrapped: false,
                message: `Error: Target directory '${targetDir}' does not exist.`
            };
        }

        // Check if manifest already exists
        const manifestPath = path.join(targetDir, 'SYSTEM_MAP.md');
        if (fs.existsSync(manifestPath)) {
            return {
                bootstrapped: false,
                message: 'Manifest already exists. Skipping bootstrap.'
            };
        }

        // Discover design file
        const designFilePath = this.findDocFile(targetDir);
        if (!designFilePath) {
            return {
                bootstrapped: false,
                message: 'No design document found. Will use default manifest template.'
            };
        }

        consoleStyler.log('system', `Found design file: ${path.basename(designFilePath)}`);

        // Read and parse the design document
        let content;
        try {
            content = await fs.promises.readFile(designFilePath, 'utf8');
        } catch (error) {
            return {
                bootstrapped: false,
                message: `Error reading design file: ${error.message}`
            };
        }

        if (!content || content.trim().length === 0) {
            return {
                bootstrapped: false,
                message: 'Design document is empty. Will use default manifest template.'
            };
        }

        const parsed = this.parseDocument(content);
        const features = this.extractFeatures(parsed);
        const invariants = this.extractInvariants(parsed);

        consoleStyler.log('system', `Extracted ${features.length} feature(s) and ${invariants.length} invariant(s) from design document.`);

        // Override manifestManager's working dir for the target
        const originalWorkingDir = this.manifestManager.workingDir;
        const originalManifestPath = this.manifestManager.manifestPath;
        const originalSnapshotsDir = this.manifestManager.snapshotsDir;

        try {
            this.manifestManager.workingDir = targetDir;
            this.manifestManager.manifestPath = manifestPath;
            this.manifestManager.snapshotsDir = path.join(targetDir, '.snapshots');

            await this.manifestManager.initManifestWithData(features, invariants);

            const featureNames = features.map(f => `${f.id}: ${f.name}`).join(', ');
            return {
                bootstrapped: true,
                message: `Project bootstrapped from ${path.basename(designFilePath)}.\n` +
                    `  Features registered: ${features.length} (${featureNames || 'none'})\n` +
                    `  Invariants registered: ${invariants.length}\n` +
                    `  Design source: ${designFilePath}`
            };
        } finally {
            // Restore original paths
            this.manifestManager.workingDir = originalWorkingDir;
            this.manifestManager.manifestPath = originalManifestPath;
            this.manifestManager.snapshotsDir = originalSnapshotsDir;
        }
    }

    /**
     * Extract features from parsed design document.
     * @param {{ title: string, sections: Array, rawContent: string }} parsed
     * @returns {Array<{id: string, name: string, phase: string, priority: string, dependencies: string}>}
     */
    extractFeatures(parsed) {
        const features = [];
        let featureCounter = 1;

        for (const section of parsed.sections) {
            const headingLower = section.heading.toLowerCase();

            // Strategy 1: Check if this is a feature-listing section
            const isFeatureListSection = FEATURE_SECTION_TITLES.some(t => headingLower.includes(t));

            if (isFeatureListSection) {
                // Extract features from bullets within this section
                const bulletFeatures = this.extractFeaturesFromBullets(section.content);
                for (const bf of bulletFeatures) {
                    const phase = this.determinePhase(bf.detail || section.content);
                    features.push({
                        id: `FEAT-${String(featureCounter++).padStart(3, '0')}`,
                        name: bf.name,
                        phase,
                        priority: 'Medium',
                        dependencies: '-'
                    });
                }
                continue;
            }

            // Strategy 2: Check if the heading itself describes a feature/component
            const isFeatureHeading = FEATURE_KEYWORDS.some(kw => headingLower.includes(kw));

            // Also check for Phase-named sections
            const isPhaseSection = /phase\s+[ivx\d]+/i.test(headingLower);

            if (isFeatureHeading || isPhaseSection) {
                const phase = this.determinePhase(section.content);
                const name = this.cleanFeatureName(section.heading);
                features.push({
                    id: `FEAT-${String(featureCounter++).padStart(3, '0')}`,
                    name,
                    phase,
                    priority: this.inferPriority(section),
                    dependencies: '-'
                });
            }
        }

        // If we found nothing, try extracting from table rows
        if (features.length === 0) {
            const tableFeatures = this.extractFeaturesFromTables(parsed.rawContent);
            for (const tf of tableFeatures) {
                features.push({
                    id: `FEAT-${String(featureCounter++).padStart(3, '0')}`,
                    name: tf,
                    phase: 'Discovery',
                    priority: 'Medium',
                    dependencies: '-'
                });
            }
        }

        return features;
    }

    /**
     * Extract feature names from bullet/numbered lists.
     * @param {string} content - Section content
     * @returns {Array<{name: string, detail: string}>}
     */
    extractFeaturesFromBullets(content) {
        const features = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const bulletMatch = line.match(/^\s*[-*]\s+\*?\*?(.+?)\*?\*?\s*$/);
            const numberedMatch = line.match(/^\s*\d+\.\s+\*?\*?(.+?)\*?\*?\s*$/);

            const match = bulletMatch || numberedMatch;
            if (match) {
                let name = match[1].trim();
                name = name.replace(/[:\.]$/, '').trim();
                name = name.replace(/\*\*/g, '').replace(/\*/g, '').trim();
                if (name.length > 2 && name.length < 100) {
                    const parts = name.split(/:\s*|—\s*|–\s*/);
                    features.push({
                        name: parts[0].trim(),
                        detail: parts.length > 1 ? parts.slice(1).join(' ').trim() : ''
                    });
                }
            }
        }

        return features;
    }

    /**
     * Extract feature-like items from markdown tables.
     * @param {string} content - Raw document content
     * @returns {string[]} Feature names
     */
    extractFeaturesFromTables(content) {
        const features = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('|')) continue;

            const cols = line.split('|').map(c => c.trim()).filter(c => c.length > 0);

            // Skip header and separator rows
            if (cols.some(c => c.match(/^-+$/))) continue;
            if (i > 0 && lines[i - 1] && lines[i - 1].includes('---')) continue;

            if (cols.length >= 2 && cols[0].length > 2) {
                const name = cols[0].replace(/\*\*/g, '').trim();
                if (!['section', 'name', 'id', 'feature', 'column', '#'].includes(name.toLowerCase())) {
                    features.push(name);
                }
            }
        }

        return features;
    }

    /**
     * Extract invariants/constraints from parsed design document.
     * @param {{ title: string, sections: Array, rawContent: string }} parsed
     * @returns {Array<{id: string, name: string, description: string}>}
     */
    extractInvariants(parsed) {
        const invariants = [];
        let invCounter = 1;

        for (const section of parsed.sections) {
            const headingLower = section.heading.toLowerCase();
            const isConstraintSection = INVARIANT_KEYWORDS.some(kw => headingLower.includes(kw));

            if (isConstraintSection) {
                const constraints = this.extractConstraintsFromBullets(section.content);
                for (const c of constraints) {
                    invariants.push({
                        id: `INV-${String(invCounter++).padStart(3, '0')}`,
                        name: c.name,
                        description: c.description
                    });
                }
                continue;
            }

            // Also scan all sections for constraint-like bullets
            const inlineConstraints = this.extractInlineConstraints(section.content);
            for (const c of inlineConstraints) {
                invariants.push({
                    id: `INV-${String(invCounter++).padStart(3, '0')}`,
                    name: c.name,
                    description: c.description
                });
            }
        }

        return this.deduplicate(invariants);
    }

    /**
     * Determine the initial phase for a feature based on content detail level.
     * @param {string} content
     * @returns {string} Phase name
     */
    determinePhase(content) {
        if (!content || content.length === 0) return 'Discovery';

        const contentLower = content.toLowerCase();

        const interfaceScore = INTERFACE_KEYWORDS.reduce((score, kw) => {
            return score + (contentLower.includes(kw) ? 1 : 0);
        }, 0);

        if (interfaceScore >= 2) return 'Interface';

        const designScore = DESIGN_REVIEW_KEYWORDS.reduce((score, kw) => {
            return score + (contentLower.includes(kw) ? 1 : 0);
        }, 0);

        if (designScore >= 2) return 'Design Review';

        return 'Discovery';
    }

    /**
     * Clean up a heading to use as a feature name.
     * @param {string} heading
     * @returns {string}
     */
    cleanFeatureName(heading) {
        return heading
            .replace(/^(phase\s+[ivx\d]+\s*[:\-–—]\s*)/i, '')
            .replace(/^(the\s+)/i, '')
            .replace(/\*\*/g, '')
            .replace(/`/g, '')
            .trim();
    }

    /**
     * Infer priority from section content and heading level.
     * @param {{ heading: string, level: number, content: string }} section
     * @returns {string}
     */
    inferPriority(section) {
        const contentLower = (section.content || '').toLowerCase();

        if (contentLower.includes('critical') || contentLower.includes('essential') ||
            contentLower.includes('core') || section.level <= 2) {
            return 'High';
        }

        if (contentLower.includes('optional') || contentLower.includes('nice to have') ||
            contentLower.includes('future') || contentLower.includes('stretch')) {
            return 'Low';
        }

        return 'Medium';
    }
}
