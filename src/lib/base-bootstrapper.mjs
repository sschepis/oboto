// BaseBootstrapper — Shared base class for project bootstrapping
// Consolidated from ProjectBootstrapper (project-management) and ProjectBootstrapper (structured-dev)
// See docs/DUPLICATE_CODE_ANALYSIS.md — DUP-1

import fs from 'fs';
import path from 'path';
import { parseMarkdownSections, extractBullets } from './markdown-utils.mjs';

// Common design file candidates (subclasses can add to these)
const BASE_DOC_CANDIDATES = ['DESIGN.md', 'ARCHITECTURE.md', 'README.md'];

// Common constraint prefixes
const CONSTRAINT_PREFIXES = [
    'must ', 'never ', 'always ', 'no ', 'all ', 'shall ',
    'cannot ', 'should not ', 'must not ', 'do not '
];

/**
 * Base class for project bootstrapping from design documents.
 * Provides shared document discovery, parsing, and extraction logic.
 * Subclasses implement domain-specific extraction and manifest creation.
 */
export class BaseBootstrapper {
    /**
     * @param {Object} manifest - Manifest manager instance (ProjectManifest or ManifestManager)
     * @param {Object} [options]
     * @param {string[]} [options.docCandidates] - Additional doc filenames to search
     * @param {string} [options.manifestFilename] - Expected manifest filename
     */
    constructor(manifest, options = {}) {
        this.manifest = manifest;
        this.docCandidates = options.docCandidates || BASE_DOC_CANDIDATES;
        this.manifestFilename = options.manifestFilename || 'MANIFEST.md';
    }

    // ── Document Discovery ──────────────────────────────────────────────

    /**
     * Find a project/design documentation file in a directory.
     * Searches candidates in priority order, skipping small READMEs.
     *
     * @param {string} dir - Directory to search
     * @returns {string|null} Path to found document, or null
     */
    findDocFile(dir) {
        for (const candidate of this.docCandidates) {
            const filePath = path.join(dir, candidate);
            if (fs.existsSync(filePath)) {
                // Skip very small README files (likely just a title)
                if (candidate === 'README.md') {
                    try {
                        const stat = fs.statSync(filePath);
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

    // ── Document Parsing ────────────────────────────────────────────────

    /**
     * Parse a markdown document into structured sections.
     * Delegates to shared parseMarkdownSections utility.
     *
     * @param {string} content - Raw markdown content
     * @returns {{ title: string, sections: Array<{heading: string, level: number, content: string}>, rawContent: string }}
     */
    parseDocument(content) {
        return parseMarkdownSections(content);
    }

    // ── Extraction Utilities ────────────────────────────────────────────

    /**
     * Extract bullet points from section content.
     * Delegates to shared extractBullets utility.
     *
     * @param {string} content - Section content
     * @param {Object} [options] - Options for bullet extraction
     * @returns {Array<{text: string, detail: string}>}
     */
    extractBullets(content, options) {
        return extractBullets(content, options);
    }

    /**
     * Extract constraint-like statements from bullet points.
     * Matches bullets starting with "Must", "Never", "Always", etc.
     *
     * @param {string} content - Section content
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
     * Extract constraints from bullet points in a constraint-focused section.
     *
     * @param {string} content - Section content
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
     * Deduplicate items by a key function.
     *
     * @param {Array} items - Items to deduplicate
     * @param {function} [keyFn] - Function to extract dedup key (default: item.name.toLowerCase())
     * @returns {Array}
     */
    deduplicate(items, keyFn = (item) => (item.name || '').toLowerCase()) {
        const seen = new Set();
        return items.filter(item => {
            const key = keyFn(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ── Template Methods (override in subclasses) ───────────────────────

    /**
     * Main bootstrap entry point. Subclasses must implement this.
     * @param {string} targetDir
     * @returns {Promise<{bootstrapped: boolean, message: string}>}
     * @abstract
     */
    async bootstrap(targetDir) {
        throw new Error('Subclasses must implement bootstrap()');
    }
}
