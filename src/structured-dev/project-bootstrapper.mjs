// Project Bootstrapper
// Discovers design documents in a target directory and pre-populates
// the SYSTEM_MAP.md manifest with extracted features and invariants.

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';

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

// Bullet prefixes that indicate constraints
const CONSTRAINT_PREFIXES = [
    'must ', 'never ', 'always ', 'no ', 'all ', 'shall ',
    'cannot ', 'should not ', 'must not ', 'do not '
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

export class ProjectBootstrapper {
    constructor(manifestManager) {
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
        const designFilePath = this.discoverDesignFile(targetDir);
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

        const parsed = this.parseDesignDoc(content);
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
     * Look for DESIGN.md, ARCHITECTURE.md, README.md in priority order.
     * @param {string} targetDir
     * @returns {string|null} Path to the found design file, or null
     */
    discoverDesignFile(targetDir) {
        for (const candidate of DESIGN_FILE_CANDIDATES) {
            const filePath = path.join(targetDir, candidate);
            if (fs.existsSync(filePath)) {
                // For README.md, only use it if it has substantial content
                if (candidate === 'README.md') {
                    try {
                        const stat = fs.statSync(filePath);
                        // Skip very small READMEs (likely just a title)
                        if (stat.size < 200) continue;
                    } catch {
                        continue;
                    }
                }
                return filePath;
            }
        }
        return null;
    }

    /**
     * Parse a markdown document into structured sections.
     * @param {string} content - Raw markdown content
     * @returns {{ title: string, sections: Array<{heading: string, level: number, content: string}>, rawContent: string }}
     */
    parseDesignDoc(content) {
        const lines = content.split('\n');
        const sections = [];
        let title = '';
        let currentSection = null;

        for (const line of lines) {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
            if (headingMatch) {
                // Save previous section
                if (currentSection) {
                    currentSection.content = currentSection.content.trim();
                    sections.push(currentSection);
                }

                const level = headingMatch[1].length;
                const heading = headingMatch[2].replace(/\*\*/g, '').trim();

                // First H1 or H2 is the title
                if (!title && level <= 2) {
                    title = heading;
                }

                currentSection = { heading, level, content: '' };
            } else if (currentSection) {
                currentSection.content += line + '\n';
            }
        }

        // Push final section
        if (currentSection) {
            currentSection.content = currentSection.content.trim();
            sections.push(currentSection);
        }

        return { title, sections, rawContent: content };
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
                // Extract features from bullets and sub-headings within this section
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

            // Also check for Phase-named sections from the project's own design doc pattern
            // e.g., "Phase I: The Discovery Anchor"
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
            // Match bullets: "- Feature Name" or "* Feature Name" or "1. Feature Name"
            const bulletMatch = line.match(/^\s*[-*]\s+\*?\*?(.+?)\*?\*?\s*$/);
            const numberedMatch = line.match(/^\s*\d+\.\s+\*?\*?(.+?)\*?\*?\s*$/);

            const match = bulletMatch || numberedMatch;
            if (match) {
                let name = match[1].trim();
                // Remove trailing punctuation like colons
                name = name.replace(/[:\.]$/, '').trim();
                // Remove markdown bold/italic
                name = name.replace(/\*\*/g, '').replace(/\*/g, '').trim();
                // Skip very short or generic items
                if (name.length > 2 && name.length < 100) {
                    // Split on colon or dash to get name vs detail
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

            // If first column looks like a section/feature name
            if (cols.length >= 2 && cols[0].length > 2) {
                const name = cols[0].replace(/\*\*/g, '').trim();
                // Skip generic table headers
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
                // Extract constraints from bullets in this section
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

        // Deduplicate by name
        const seen = new Set();
        return invariants.filter(inv => {
            const key = inv.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Extract constraints from bullet points in a constraint-focused section.
     * @param {string} content
     * @returns {Array<{name: string, description: string}>}
     */
    extractConstraintsFromBullets(content) {
        const constraints = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
            if (!bulletMatch) continue;

            let text = bulletMatch[1].replace(/\*\*/g, '').trim();
            if (text.length < 5) continue;

            // Split on colon for name:description pattern
            const parts = text.split(/:\s*/);
            if (parts.length >= 2) {
                constraints.push({
                    name: parts[0].trim().substring(0, 40),
                    description: parts.slice(1).join(': ').trim()
                });
            } else {
                // Use first few words as name, full text as description
                const words = text.split(/\s+/);
                constraints.push({
                    name: words.slice(0, 4).join(' '),
                    description: text
                });
            }
        }

        return constraints;
    }

    /**
     * Scan content for inline constraint-like statements.
     * These are bullets starting with "Must", "Never", "Always", etc.
     * @param {string} content
     * @returns {Array<{name: string, description: string}>}
     */
    extractInlineConstraints(content) {
        const constraints = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
            if (!bulletMatch) continue;

            const text = bulletMatch[1].replace(/\*\*/g, '').trim();
            const textLower = text.toLowerCase();

            const isConstraint = CONSTRAINT_PREFIXES.some(prefix => textLower.startsWith(prefix));
            if (isConstraint) {
                const words = text.split(/\s+/);
                constraints.push({
                    name: words.slice(0, 4).join(' '),
                    description: text
                });
            }
        }

        return constraints;
    }

    /**
     * Determine the initial phase for a feature based on content detail level.
     * @param {string} content - The feature's descriptive content
     * @returns {string} Phase name
     */
    determinePhase(content) {
        if (!content || content.length === 0) return 'Discovery';

        const contentLower = content.toLowerCase();

        // Check for interface-level detail
        const interfaceScore = INTERFACE_KEYWORDS.reduce((score, kw) => {
            return score + (contentLower.includes(kw) ? 1 : 0);
        }, 0);

        if (interfaceScore >= 2) return 'Interface';

        // Check for design-review-level detail
        const designScore = DESIGN_REVIEW_KEYWORDS.reduce((score, kw) => {
            return score + (contentLower.includes(kw) ? 1 : 0);
        }, 0);

        if (designScore >= 2) return 'Design Review';

        // Default to Discovery
        return 'Discovery';
    }

    /**
     * Clean up a heading to use as a feature name.
     * @param {string} heading
     * @returns {string}
     */
    cleanFeatureName(heading) {
        return heading
            .replace(/^(phase\s+[ivx\d]+\s*[:\-–—]\s*)/i, '')  // Remove "Phase I: " prefix
            .replace(/^(the\s+)/i, '')                          // Remove leading "The "
            .replace(/\*\*/g, '')                                // Remove bold
            .replace(/`/g, '')                                   // Remove code ticks
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
