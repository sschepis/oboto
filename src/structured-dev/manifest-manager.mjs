// Manifest Manager
// Handles the creation, reading, and updating of the SYSTEM_MAP.md file
// This file serves as the "Living Manifest" for the structured development process
// Refactored to extend BaseManifest (see docs/DUPLICATE_CODE_ANALYSIS.md — DUP-2)

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';
import { BaseManifest } from '../lib/base-manifest.mjs';
import { extractColumns } from '../lib/markdown-utils.mjs';

const CURSOR_RULES_TEMPLATE = `# Structured Development Rules

READ \`SYSTEM_MAP.md\` BEFORE any coding request.

## Rules
1. **Read manifest first** — understand current state, locks, and invariants.
2. **Respect locks:**
   - Interface/Implementation phase features have LOCKED API signatures. NEVER change without explicit user override.
   - Locked features: NEVER modify.
3. **Follow phase flow:**
   - Discovery → \`submit_technical_design\`
   - Design Review → wait for approval → \`approve_design\`
   - Interface → define types → \`lock_interfaces\`
   - Implementation → write code → \`submit_critique\` → finalize

## Tools
\`read_manifest\`, \`submit_technical_design\`, \`approve_design\`, \`lock_interfaces\`, \`submit_critique\`
`;

export class ManifestManager extends BaseManifest {
    constructor(workingDir) {
        super(workingDir, 'SYSTEM_MAP.md', '.snapshots');
    }

    // Initialize the manifest with a template
    async initManifest() {
        if (this.hasManifest()) {
            return "Manifest already exists.";
        }

        // Create snapshots directory
        if (!fs.existsSync(this.snapshotsDir)) {
            await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
        }

        const template = `# System Manifest (SYSTEM_MAP.md)
Last Updated: ${new Date().toISOString()}

## 1. Global Invariants
| ID | Invariant | Description |
|---|---|---|
| INV-001 | No External Math Libs | Use standard Math library only. |
| INV-002 | Strict Typing | All interfaces must be defined in .d.ts files. |

## 2. Feature Registry
| Feature ID | Name | Status | Phase | Lock Level | Priority | Dependencies |
|---|---|---|---|---|---|---|
| FEAT-000 | System Init | Active | Discovery | None | High | - |

## 3. Dependency Graph
- FEAT-000: System Init

## 4. State Snapshots
- [${new Date().toISOString()}] Initial State Created
`;

        // Create example hooks file
        const hooksExample = {
            "on_lock": "echo 'Feature locked!'",
            "on_phase_change": "echo 'Phase changed'"
        };
        const hooksDir = path.join(this.workingDir, '.ai-man');
        if (!fs.existsSync(hooksDir)) {
            await fs.promises.mkdir(hooksDir, { recursive: true });
        }
        await fs.promises.writeFile(path.join(hooksDir, 'hooks.json.example'), JSON.stringify(hooksExample, null, 2), 'utf8');

        try {
            await this.writeManifest(template);
            consoleStyler.log('system', 'Created SYSTEM_MAP.md');
            
            // Also create .cursorrules
            await this._writeCursorRules();

            await this.createSnapshot('Initial Init');

            return "SYSTEM_MAP.md and .cursorrules created successfully.";
        } catch (error) {
            consoleStyler.log('error', `Failed to create manifest: ${error.message}`);
            throw error;
        }
    }

    // Initialize the manifest with pre-extracted design data
    async initManifestWithData(features, invariants) {
        if (this.hasManifest()) {
            return "Manifest already exists.";
        }

        // Create snapshots directory
        if (!fs.existsSync(this.snapshotsDir)) {
            await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
        }

        // Build invariants table
        let invariantsTable = '| ID | Invariant | Description |\n|---|---|---|';
        if (invariants && invariants.length > 0) {
            for (const inv of invariants) {
                invariantsTable += `\n| ${inv.id} | ${inv.name} | ${inv.description} |`;
            }
        } else {
            invariantsTable += '\n| INV-001 | (none extracted) | No invariants found in design document. |';
        }

        // Build feature registry table
        let featureTable = '| Feature ID | Name | Status | Phase | Lock Level | Priority | Dependencies |\n|---|---|---|---|---|---|---|';
        if (features && features.length > 0) {
            for (const feat of features) {
                featureTable += `\n| ${feat.id} | ${feat.name} | Active | ${feat.phase} | None | ${feat.priority} | ${feat.dependencies} |`;
            }
        } else {
            featureTable += '\n| FEAT-000 | System Init | Active | Discovery | None | High | - |';
        }

        // Build dependency graph
        let depGraph = '';
        if (features && features.length > 0) {
            for (const feat of features) {
                depGraph += `- ${feat.id}: ${feat.name}\n`;
            }
        } else {
            depGraph = '- FEAT-000: System Init\n';
        }

        const template = `# System Manifest (SYSTEM_MAP.md)
Last Updated: ${new Date().toISOString()}

## 1. Global Invariants
${invariantsTable}

## 2. Feature Registry
${featureTable}

## 3. Dependency Graph
${depGraph.trimEnd()}

## 4. State Snapshots
- [${new Date().toISOString()}] Initial State Created (bootstrapped from design document)
`;

        // Create .ai-man directory and hooks example
        const hooksExample = {
            "on_lock": "echo 'Feature locked!'",
            "on_phase_change": "echo 'Phase changed'"
        };
        const hooksDir = path.join(this.workingDir, '.ai-man');
        if (!fs.existsSync(hooksDir)) {
            await fs.promises.mkdir(hooksDir, { recursive: true });
        }
        await fs.promises.writeFile(path.join(hooksDir, 'hooks.json.example'), JSON.stringify(hooksExample, null, 2), 'utf8');

        try {
            await this.writeManifest(template);
            consoleStyler.log('system', 'Created SYSTEM_MAP.md (bootstrapped from design document)');

            // Also create .cursorrules
            await this._writeCursorRules();

            await this.createSnapshot('Initial Init (bootstrapped)');

            return "SYSTEM_MAP.md created with pre-populated design data.";
        } catch (error) {
            consoleStyler.log('error', `Failed to create manifest: ${error.message}`);
            throw error;
        }
    }

    // Write .cursorrules file if it doesn't exist
    async _writeCursorRules() {
        const cursorRulesPath = path.join(this.workingDir, '.cursorrules');
        if (!fs.existsSync(cursorRulesPath)) {
            await fs.promises.writeFile(cursorRulesPath, CURSOR_RULES_TEMPLATE, 'utf8');
            consoleStyler.log('system', 'Created .cursorrules');
        }
    }

    // Add an invariant to the Global Invariants section
    async addInvariant(id, name, description) {
        const currentManifest = await this.readManifest();
        const invariantsRegex = /## 1. Global Invariants([\s\S]*?)(?=## 2|$)/;
        const match = currentManifest.match(invariantsRegex);

        if (!match) return `Error: Global Invariants section not found.`;

        let rawTable = match[1].trim();
        let rows = rawTable.split('\n').map(row => row.trim()).filter(row => row.length > 0);

        // Headers
        const headerRow = "| ID | Invariant | Description |";
        const separatorRow = "|---|---|---|";

        // Parse existing invariants
        const invariantMap = new Map();
        let startIndex = 0;
        if (rows[0] && rows[0].startsWith('| ID')) startIndex = 2;

        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            if (!row.startsWith('|')) continue;
            const cols = extractColumns(row);
            if (cols.length > 0) {
                while (cols.length < 3) cols.push('-');
                invariantMap.set(cols[0], cols);
            }
        }

        // Add or update
        invariantMap.set(id, [id, name, description]);

        // Reconstruct table
        let newTable = `${headerRow}\n${separatorRow}`;
        for (const [_, cols] of invariantMap) {
            newTable += `\n| ${cols.join(' | ')} |`;
        }

        await this.updateSection('1. Global Invariants', newTable);
        return `Invariant ${id} added/updated.`;
    }

    // Add a feature to the registry (Robust Parsing Implementation)
    async addFeature(id, name, status = 'Active', phase = 'Discovery', lockLevel = 'None', priority = 'Medium', dependencies = '-') {
        const currentManifest = await this.readManifest();
        const registryRegex = /## 2. Feature Registry([\s\S]*?)(?=## 3|$)/;
        const match = currentManifest.match(registryRegex);
        
        if (!match) return `Error: Feature Registry section not found.`;

        let rawTable = match[1].trim();
        let rows = rawTable.split('\n').map(row => row.trim()).filter(row => row.length > 0);
        
        // Ensure correct headers
        const headerRow = "| Feature ID | Name | Status | Phase | Lock Level | Priority | Dependencies |";
        const separatorRow = "|---|---|---|---|---|---|---|";

        // Parse existing data into a map for easy updating
        const featureMap = new Map();
        
        // Skip header and separator (start at index 2 if they exist)
        let startIndex = 0;
        if (rows[0] && rows[0].startsWith('| Feature ID')) startIndex = 2;
        
        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            if (!row.startsWith('|')) continue;
            
            const cols = extractColumns(row);
            if (cols.length > 0) {
                // Handle legacy rows by padding
                while (cols.length < 7) cols.push('-');
                featureMap.set(cols[0], cols);
            }
        }

        // Update or Add the feature
        // Schema: [ID, Name, Status, Phase, Lock, Priority, Dependencies]
        featureMap.set(id, [id, name, status, phase, lockLevel, priority, dependencies]);

        // Reconstruct Table
        let newTable = `${headerRow}\n${separatorRow}`;
        for (const [_, cols] of featureMap) {
            newTable += `\n| ${cols.join(' | ')} |`;
        }

        await this.updateSection('2. Feature Registry', newTable);
        return `Feature ${id} added/updated in registry.`;
    }

    // Override _appendSnapshotLog for SYSTEM_MAP's specific section header
    async _appendSnapshotLog(description, snapshotFilename) {
        let content = await fs.promises.readFile(this.manifestPath, 'utf8');
        const snapshotLog = `- [${new Date().toISOString()}] Snapshot: ${description} (${snapshotFilename})`;
        
        const snapshotsRegex = /## 4. State Snapshots([\s\S]*?)$/;
        if (snapshotsRegex.test(content)) {
            content = content.replace(snapshotsRegex, (match, p1) => {
                 return `## 4. State Snapshots${p1.trimEnd()}\n${snapshotLog}\n`;
            });
        }
        await fs.promises.writeFile(this.manifestPath, content, 'utf8');
    }

    // Override restoreSnapshot to log via consoleStyler
    async restoreSnapshot(snapshotId) {
        const result = await super.restoreSnapshot(snapshotId);
        if (result.success) {
            consoleStyler.log('system', result.message);
        }
        return result;
    }
}
