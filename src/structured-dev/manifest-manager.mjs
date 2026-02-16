// Manifest Manager
// Handles the creation, reading, and updating of the SYSTEM_MAP.md file
// This file serves as the "Living Manifest" for the structured development process

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';

export class ManifestManager {
    constructor(workingDir) {
        this.workingDir = workingDir;
        this.manifestPath = path.join(workingDir, 'SYSTEM_MAP.md');
        this.snapshotsDir = path.join(workingDir, '.snapshots');
    }

    // Check if the manifest exists
    hasManifest() {
        return fs.existsSync(this.manifestPath);
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

        const cursorRulesTemplate = `# Roo Code - Structured Development Rules

You are an AI assistant operating within a **Structured Development Framework**.
Your behavior must be governed by the "Living Manifest" (SYSTEM_MAP.md) located in the project root.

## Core Directives

1. **Check the Manifest First**: Before answering any coding request, read \`SYSTEM_MAP.md\` to understand the current system state, locked features, and global invariants.
2. **Respect Locks**:
   - If a feature is in **Interface** or **Implementation** phase, its API signatures are **LOCKED**. You cannot change them without explicit user override.
   - If a feature is **Locked**, you cannot modify it.
3. **Follow the Flow**:
   - **Discovery Phase**: Analyze requirements -> Call \`submit_technical_design\`.
   - **Design Review**: Wait for user approval -> Call \`approve_design\`.
   - **Interface Phase**: Define types -> Call \`lock_interfaces\`.
   - **Implementation Phase**: Write code -> Call \`submit_critique\` -> Finalize.

## Tool Usage

- Use \`read_manifest\` to access the system map.
- Use \`submit_technical_design\`, \`approve_design\`, \`lock_interfaces\`, and \`submit_critique\` to move through the development phases.
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
            await fs.promises.writeFile(this.manifestPath, template, 'utf8');
            consoleStyler.log('system', 'Created SYSTEM_MAP.md');
            
            // Also create .cursorrules
            const cursorRulesPath = path.join(this.workingDir, '.cursorrules');
            if (!fs.existsSync(cursorRulesPath)) {
                await fs.promises.writeFile(cursorRulesPath, cursorRulesTemplate, 'utf8');
                consoleStyler.log('system', 'Created .cursorrules');
            }

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

        const cursorRulesTemplate = `# Roo Code - Structured Development Rules

You are an AI assistant operating within a **Structured Development Framework**.
Your behavior must be governed by the "Living Manifest" (SYSTEM_MAP.md) located in the project root.

## Core Directives

1. **Check the Manifest First**: Before answering any coding request, read \`SYSTEM_MAP.md\` to understand the current system state, locked features, and global invariants.
2. **Respect Locks**:
   - If a feature is in **Interface** or **Implementation** phase, its API signatures are **LOCKED**. You cannot change them without explicit user override.
   - If a feature is **Locked**, you cannot modify it.
3. **Follow the Flow**:
   - **Discovery Phase**: Analyze requirements -> Call \`submit_technical_design\`.
   - **Design Review**: Wait for user approval -> Call \`approve_design\`.
   - **Interface Phase**: Define types -> Call \`lock_interfaces\`.
   - **Implementation Phase**: Write code -> Call \`submit_critique\` -> Finalize.

## Tool Usage

- Use \`read_manifest\` to access the system map.
- Use \`submit_technical_design\`, \`approve_design\`, \`lock_interfaces\`, and \`submit_critique\` to move through the development phases.
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
            await fs.promises.writeFile(this.manifestPath, template, 'utf8');
            consoleStyler.log('system', 'Created SYSTEM_MAP.md (bootstrapped from design document)');

            // Also create .cursorrules
            const cursorRulesPath = path.join(this.workingDir, '.cursorrules');
            if (!fs.existsSync(cursorRulesPath)) {
                await fs.promises.writeFile(cursorRulesPath, cursorRulesTemplate, 'utf8');
                consoleStyler.log('system', 'Created .cursorrules');
            }

            await this.createSnapshot('Initial Init (bootstrapped)');

            return "SYSTEM_MAP.md created with pre-populated design data.";
        } catch (error) {
            consoleStyler.log('error', `Failed to create manifest: ${error.message}`);
            throw error;
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
            const cols = row.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
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

    // Read the manifest content
    async readManifest() {
        if (!this.hasManifest()) {
            return null;
        }

        try {
            return await fs.promises.readFile(this.manifestPath, 'utf8');
        } catch (error) {
            consoleStyler.log('error', `Failed to read manifest: ${error.message}`);
            throw error;
        }
    }

    // Update a specific section of the manifest
    async updateSection(sectionName, newContent) {
        if (!this.hasManifest()) {
            throw new Error("Manifest not found. Please initialize structured development first.");
        }

        // Create snapshot before update
        await this.createSnapshot(`Pre-update: ${sectionName}`);

        let content = await this.readManifest();
        const sectionRegex = new RegExp(`## ${sectionName}[\\s\\S]*?(?=## |$)`, 'g');
        
        if (!sectionRegex.test(content)) {
            // Section doesn't exist, append it
            content += `\n\n## ${sectionName}\n${newContent}`;
        } else {
            // Replace existing section
            content = content.replace(sectionRegex, `## ${sectionName}\n${newContent}\n`);
        }

        // Update timestamp
        content = content.replace(/Last Updated: .*/, `Last Updated: ${new Date().toISOString()}`);

        try {
            await fs.promises.writeFile(this.manifestPath, content, 'utf8');
            consoleStyler.log('system', `Updated section: ${sectionName}`);
            return `Section '${sectionName}' updated successfully.`;
        } catch (error) {
            consoleStyler.log('error', `Failed to update manifest: ${error.message}`);
            throw error;
        }
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
            
            const cols = row.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
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

    // Create a snapshot of the current manifest
    async createSnapshot(description) {
        if (!this.hasManifest()) return;

        try {
            if (!fs.existsSync(this.snapshotsDir)) {
                await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const snapshotFilename = `SYSTEM_MAP.${timestamp}.md`;
            const snapshotPath = path.join(this.snapshotsDir, snapshotFilename);
            
            await fs.promises.copyFile(this.manifestPath, snapshotPath);
            
            // Append to State Snapshots section (without triggering another snapshot)
            // We read file directly to avoid loop
            let content = await fs.promises.readFile(this.manifestPath, 'utf8');
            const snapshotLog = `- [${new Date().toISOString()}] Snapshot: ${description} (${snapshotFilename})`;
            
            const snapshotsRegex = /## 4. State Snapshots([\s\S]*?)$/;
            if (snapshotsRegex.test(content)) {
                content = content.replace(snapshotsRegex, (match, p1) => {
                     return `## 4. State Snapshots${p1.trimEnd()}\n${snapshotLog}\n`;
                });
            }
             await fs.promises.writeFile(this.manifestPath, content, 'utf8');

        } catch (error) {
            consoleStyler.log('error', `Failed to create snapshot: ${error.message}`);
        }
    }

    // Restore a snapshot
    async restoreSnapshot(snapshotId) {
        // If snapshotId is not full path, look in dir
        let targetPath = snapshotId;
        if (!path.isAbsolute(snapshotId) && !snapshotId.includes('/')) {
             targetPath = path.join(this.snapshotsDir, snapshotId);
        }

        if (!fs.existsSync(targetPath)) {
             // Try searching for file containing timestamp if partial ID provided
             const files = await fs.promises.readdir(this.snapshotsDir);
             const match = files.find(f => f.includes(snapshotId));
             if (match) {
                 targetPath = path.join(this.snapshotsDir, match);
             } else {
                 return `Error: Snapshot ${snapshotId} not found.`;
             }
        }

        try {
            await fs.promises.copyFile(targetPath, this.manifestPath);
            consoleStyler.log('system', `Restored manifest from ${path.basename(targetPath)}`);
            return `System restored to state from ${path.basename(targetPath)}`;
        } catch (error) {
            return `Error restoring snapshot: ${error.message}`;
        }
    }

    // List available snapshots
    async listSnapshots() {
        if (!fs.existsSync(this.snapshotsDir)) return [];
        const files = await fs.promises.readdir(this.snapshotsDir);
        return files.filter(f => f.endsWith('.md')).sort().reverse();
    }
}
