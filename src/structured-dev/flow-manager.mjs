// Flow Manager
// Enforces the Discovery -> Interface -> Implementation loop
// Validates transitions and interacts with the ManifestManager

import { consoleStyler } from '../ui/console-styler.mjs';
import { ProjectBootstrapper } from './project-bootstrapper.mjs';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export class FlowManager {
    constructor(manifestManager, aiAssistantClass = null) {
        this.manifestManager = manifestManager;
        this.aiAssistantClass = aiAssistantClass;
    }

    // Phases definition
    static PHASES = {
        DISCOVERY: 'Discovery',
        DESIGN_REVIEW: 'Design Review',
        INTERFACE: 'Interface',
        IMPLEMENTATION: 'Implementation',
        LOCKED: 'Locked'
    };

    // Initialize structured development
    // If targetDir is provided and contains a design doc, bootstrap from it.
    async initStructuredDev(targetDir = null) {
        const dir = targetDir || this.manifestManager.workingDir;

        // Attempt bootstrap from design document
        const bootstrapper = new ProjectBootstrapper(this.manifestManager);
        const bootstrapResult = await bootstrapper.bootstrap(dir);

        if (bootstrapResult.bootstrapped) {
            // Design file was found and manifest was pre-populated
            const hooksResult = await this.initHooks();
            return `${bootstrapResult.message}\n${hooksResult}`;
        }

        // No design file found or manifest already exists — fall back to default init
        consoleStyler.log('system', bootstrapResult.message);
        const manifestResult = await this.manifestManager.initManifest();
        const hooksResult = await this.initHooks();
        return `${manifestResult}\n${hooksResult}`;
    }

    // Initialize Default Hooks
    async initHooks() {
        const hooksDir = path.join(this.manifestManager.workingDir, '.oboto');
        const hooksPath = path.join(hooksDir, 'hooks.json.example');
        
        if (!fs.existsSync(hooksDir)) {
            await fs.promises.mkdir(hooksDir, { recursive: true });
        }

        if (!fs.existsSync(hooksPath)) {
            const defaultHooks = {
                "on_lock": [
                    { "command": "echo 'Locked feature: ${featureId}'" }
                ],
                "on_phase_change": [
                    { "command": "echo 'Phase changed for ${featureId}'" }
                ]
            };
            await fs.promises.writeFile(hooksPath, JSON.stringify(defaultHooks, null, 2), 'utf8');
            return "Created .oboto/hooks.json.example";
        }
        return "Hooks example already exists.";
    }

    // Submit a technical design (Phase I)
    // Validates that the feature is in Discovery or new
    async submitTechnicalDesign(featureId, designDoc) {
        if (!this.manifestManager.hasManifest()) {
            return "Error: No manifest found. Run init_structured_dev first.";
        }

        // Logic to validate design doc (placeholder for now)
        if (!designDoc || designDoc.length < 50) {
            return "Error: Design document is too short. Please provide a comprehensive technical design.";
        }

        // Update manifest: Move to Design Review phase
        // In a real implementation, we might save the design doc to a file
        await this.manifestManager.addFeature(featureId, "Unknown Feature", "Active", FlowManager.PHASES.DESIGN_REVIEW, "None");
        
        // Log snapshot
        await this.manifestManager.updateSection('4. State Snapshots', `- [${new Date().toISOString()}] Design submitted for ${featureId}. Entering Design Review.`);

        await this.generateStatusUpdate("Technical Design Submitted", `Feature: ${featureId}`);

        return `Technical design for ${featureId} submitted. Phase moved to ${FlowManager.PHASES.DESIGN_REVIEW}. Waiting for approval.`;
    }

    // Approve design (Phase I.5)
    // Moves feature from Design Review to Interface
    async approveDesign(featureId, feedback = "") {
         if (!this.manifestManager.hasManifest()) {
            return "Error: No manifest found.";
        }

        const manifest = await this.manifestManager.readManifest();
        if (!manifest.includes(`| ${featureId}`)) {
             return `Error: Feature ${featureId} not found.`;
        }

        // Simple check: Is it in Design Review?
        // (For robustness, we should parse the table, but regex check is okay for now)
        // We'll trust the manifest update to handle the transition correctly if we just set the new phase.
        
        await this.manifestManager.addFeature(featureId, "Unknown Feature", "Active", FlowManager.PHASES.INTERFACE, "None");
        await this.manifestManager.updateSection('4. State Snapshots', `- [${new Date().toISOString()}] Design approved for ${featureId}. Feedback: ${feedback}`);
        
        await this.generateStatusUpdate("Design Approved", `Feature: ${featureId}. Feedback: ${feedback}`);

        return `Design for ${featureId} APPROVED. Phase moved to ${FlowManager.PHASES.INTERFACE}.`;
    }


    // Lock interfaces (Phase II)
    // Validates that the feature is in Interface phase
    async lockInterfaces(featureId, interfaceDefinitions) {
         if (!this.manifestManager.hasManifest()) {
            return "Error: No manifest found.";
        }

        // Verify feature state (simplified)
        const manifest = await this.manifestManager.readManifest();
        if (!manifest.includes(`| ${featureId}`)) {
             // Implicitly allow if not strictly tracked yet, or fail. Let's auto-add for flexibility.
             await this.manifestManager.addFeature(featureId, "Unknown Feature", "Active", FlowManager.PHASES.INTERFACE, "Partial");
        }
        
        // Check if feature is in Design Review (Must initiate approval first)
        // We need a more robust way to check phase than just string inclusion if we want to be strict.
        // For now, if the manifest line contains "Design Review", we should block.
        const featureRow = manifest.split('\n').find(line => line.includes(`| ${featureId} `));
        if (featureRow) {
            const cols = featureRow.split('|').map(c => c.trim());
            // | ID | Name | Status | Phase | Lock | Priority | Dependencies |
            // Index 4 is Phase
            if (cols[4] === FlowManager.PHASES.DESIGN_REVIEW) {
                return `Error: Feature ${featureId} is in Design Review. You must call 'approve_design' before locking interfaces.`;
            }
        }

        // Automated Validation
        const validationErrors = this.validateInterfaces(interfaceDefinitions);
        if (validationErrors.length > 0) {
            return `Error: Interface validation failed:\n- ${validationErrors.join('\n- ')}`;
        }

        // Logic to validate interfaces (e.g., check for .d.ts content)
        if (!interfaceDefinitions.includes('interface') && !interfaceDefinitions.includes('type')) {
             return "Error: No interface definitions found.";
        }

        // Update manifest
        await this.manifestManager.addFeature(featureId, "Unknown Feature", "Active", FlowManager.PHASES.IMPLEMENTATION, "Interface");
        
        // Trigger hooks
        await this.executeHooks('on_lock', { featureId });

        await this.generateStatusUpdate("Interfaces Locked", `Feature: ${featureId}`);

        return `Interfaces for ${featureId} LOCKED. Phase moved to ${FlowManager.PHASES.IMPLEMENTATION}.`;
    }

    validateInterfaces(definitions) {
        const errors = [];
        
        // 1. Syntax Check
        // We look for 'interface X' or 'type X =' patterns.
        const interfaceMatch = definitions.match(/interface\s+(\w+)/g);
        const typeMatch = definitions.match(/type\s+(\w+)\s*=/g);

        if (!interfaceMatch && !typeMatch) {
            errors.push("No 'interface' or 'type' definitions found.");
        }

        // 2. Strict JSDoc Check
        // Ensure that EVERY interface or type is immediately preceded by a JSDoc comment.
        // We'll iterate through lines to check this relationship.
        const lines = definitions.split('\n');
        let expectingDef = false;
        
        // This is a heuristic parser.
        // A perfect parser would use the TypeScript compiler API, but that's heavy.
        // We will scan for definitions and check if the previous non-empty lines constitute a JSDoc block.
        
        const definedTypes = [];
        if (interfaceMatch) interfaceMatch.forEach(m => definedTypes.push(m.split(/\s+/)[1]));
        if (typeMatch) typeMatch.forEach(m => definedTypes.push(m.split(/\s+/)[1]));

        for (const typeName of definedTypes) {
             // Find line index of definition
             const defIndex = lines.findIndex(l => l.includes(`interface ${typeName}`) || l.includes(`type ${typeName}`));
             if (defIndex === -1) continue;

             // Look backwards for JSDoc end '*/'
             let foundJSDoc = false;
             for (let i = defIndex - 1; i >= 0; i--) {
                 const line = lines[i].trim();
                 if (line === '') continue; // Skip empty lines
                 if (line.endsWith('*/')) {
                     foundJSDoc = true;
                     break;
                 }
                 // If we hit code or something else before '*/', then it's undocumented
                 if (line.length > 0) break;
             }

             if (!foundJSDoc) {
                 errors.push(`Missing JSDoc for '${typeName}'.`);
             }
        }

        return errors;
    }

    // Submit critique (Phase III)
    // Mandatory step before final implementation
    async submitCritique(featureId, critique) {
        if (!this.manifestManager.hasManifest()) {
            return "Error: No manifest found.";
        }

        // Check for 3 flaws
        const flaws = critique.match(/\d+\./g) || [];
        if (flaws.length < 3) {
            return "Error: Critique must identify at least 3 potential flaws.";
        }

        // Update manifest
        await this.manifestManager.updateSection('4. State Snapshots', `- [${new Date().toISOString()}] Critique submitted for ${featureId}`);

        return `Critique accepted for ${featureId}. You may proceed with final implementation.`;
    }
    
    // Read the current manifest
    async readManifest() {
        return await this.manifestManager.readManifest();
    }

    // Visualize Architecture (Dependency Graph)
    async visualizeArchitecture() {
        if (!this.manifestManager.hasManifest()) {
            return "Error: No manifest found.";
        }
        
        const manifest = await this.manifestManager.readManifest();
        const graphSection = manifest.match(/## 3. Dependency Graph([\s\S]*?)(?=##|$)/);
        
        if (!graphSection) {
            return "graph TD;\nError[No Dependency Graph Section Found]";
        }

        // Parse section
        const lines = graphSection[1].trim().split('\n');
        let mermaid = "graph TD;\n";
        
        // Simple parser: "- A: Description" or "- A depends on B"
        // Better: rely on Feature Registry Dependencies column
        
        const registrySection = manifest.match(/## 2. Feature Registry([\s\S]*?)(?=## 3|$)/);
        if (registrySection) {
            const rows = registrySection[1].trim().split('\n').filter(l => l.trim().startsWith('|') && !l.includes('Feature ID') && !l.includes('---'));
            
            for (const row of rows) {
                const cols = row.split('|').map(c => c.trim());
                // | ID | Name | Status | Phase | Lock | Priority | Dependencies |
                // Index 1 = ID, 2 = Name, 7 = Dependencies
                if (cols.length >= 8) {
                    const id = cols[1];
                    const name = cols[2];
                    const deps = cols[7];
                    
                    mermaid += `    ${id}["${id}: ${name}"]\n`;
                    
                    if (deps && deps !== '-') {
                        const depList = deps.split(',').map(d => d.trim());
                        for (const dep of depList) {
                            mermaid += `    ${dep} --> ${id}\n`;
                        }
                    }
                }
            }
        }
        
        return mermaid;
    }

    // Generate AI Status Update
    async generateStatusUpdate(action, details) {
        if (!this.aiAssistantClass) return;

        try {
            // Create a lightweight assistant instance for status generation
            // We assume basic config is handled by the class/environment
            const assistant = new this.aiAssistantClass(this.manifestManager.workingDir);
            
            // Allow the assistant to initialize (e.g. load keys/config)
            // Note: If initialization is heavy, this might add latency.
            // In a persistent server process, we'd reuse an instance.
            
            let manifest = "";
            try {
                manifest = await this.manifestManager.readManifest();
            } catch (e) {
                manifest = "Manifest not available.";
            }

            const prompt = `Generate a 1-2 sentence project status update. Start with "Status: ". No markdown.

Action: "${action}"
Details: ${details}

Manifest:
${manifest.substring(0, 2000)}

Include: current state + immediate next step.`;

            const status = await assistant.run(prompt);
            consoleStyler.log('system', status);
            return status;
        } catch (e) {
            // Fail silently/warn so we don't block the main flow
            consoleStyler.log('warning', `Failed to generate status update: ${e.message}`);
        }
    }

    // Execute External Hooks
    async executeHooks(event, context) {
        const hooksPath = path.join(this.manifestManager.workingDir, '.oboto', 'hooks.json');
        if (!fs.existsSync(hooksPath)) return; // No hooks configured

        try {
            const hooksConfig = JSON.parse(await fs.promises.readFile(hooksPath, 'utf8'));
            const commands = hooksConfig[event];

            if (commands && Array.isArray(commands)) {
                for (const cmdObj of commands) {
                    let cmd = cmdObj.command;
                    // Interpolate context
                    for (const [key, value] of Object.entries(context)) {
                        cmd = cmd.replace(new RegExp(`\\$\{${key}\\}`, 'g'), value);
                    }
                    
                    consoleStyler.log('system', `Executing hook: ${cmd}`);
                    try {
                        const { stdout, stderr } = await execPromise(cmd, { cwd: this.manifestManager.workingDir });
                        if (stdout) console.log(`Hook Output: ${stdout}`);
                        if (stderr) console.error(`Hook Error: ${stderr}`);
                    } catch (e) {
                         consoleStyler.log('error', `Hook failed: ${e.message}`);
                    }
                }
            }
        } catch (error) {
             consoleStyler.log('error', `Failed to execute hooks: ${error.message}`);
        }
    }
}
