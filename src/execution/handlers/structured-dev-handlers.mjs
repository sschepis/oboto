import { consoleStyler } from '../../ui/console-styler.mjs';
import path from 'path';
import { ManifestManager } from '../../structured-dev/manifest-manager.mjs';
import { FlowManager } from '../../structured-dev/flow-manager.mjs';

export class StructuredDevHandlers {
    constructor(workspaceRoot, aiAssistantClass, manifestManager) {
        this.workspaceRoot = workspaceRoot;
        this.manifestManager = manifestManager;
        
        // Initialize flow manager here or reuse passed in managers if already instantiated
        this.flowManager = new FlowManager(this.manifestManager, aiAssistantClass);
    }

    async initStructuredDev(args) {
        const targetDir = args.target_dir || null;
        consoleStyler.log('system', `Initializing Structured Development${targetDir ? ` at ${targetDir}` : ''}...`);
        return await this.flowManager.initStructuredDev(targetDir);
    }

    async bootstrapProject(args) {
        const targetDir = args.target_dir || this.manifestManager.workingDir;
        consoleStyler.log('system', `Bootstrapping project at ${targetDir}...`);

        // Create a ManifestManager for the target directory
        const bootstrapManifest = new ManifestManager(targetDir);
        const bootstrapFlow = new FlowManager(bootstrapManifest);
        return await bootstrapFlow.initStructuredDev(targetDir);
    }

    async submitTechnicalDesign(args) {
        const { feature_id, design_doc } = args;
        consoleStyler.log('system', `Submitting technical design for ${feature_id}...`);
        return await this.flowManager.submitTechnicalDesign(feature_id, design_doc);
    }

    async approveDesign(args) {
        const { feature_id, feedback } = args;
        consoleStyler.log('system', `Approving design for ${feature_id}...`);
        return await this.flowManager.approveDesign(feature_id, feedback);
    }

    async lockInterfaces(args) {
        const { feature_id, interface_definitions } = args;
        consoleStyler.log('system', `Locking interfaces for ${feature_id}...`);
        return await this.flowManager.lockInterfaces(feature_id, interface_definitions);
    }

    async submitCritique(args) {
        const { feature_id, critique } = args;
        consoleStyler.log('system', `Submitting critique for ${feature_id}...`);
        return await this.flowManager.submitCritique(feature_id, critique);
    }

    async readManifest(args) {
        consoleStyler.log('system', 'Reading manifest...');
        const content = await this.flowManager.readManifest();
        if (!content) return "No manifest found.";
        return content;
    }

    async visualizeArchitecture(args) {
        consoleStyler.log('system', 'Generating architecture visualization...');
        return await this.flowManager.visualizeArchitecture();
    }

    async rollbackToSnapshot(args) {
        const { snapshot_id } = args;
        if (!snapshot_id) {
            consoleStyler.log('system', 'Listing available snapshots...');
            const snapshots = await this.manifestManager.listSnapshots();
            return `Available Snapshots:\n${snapshots.join('\n')}\n\nUse this tool again with a snapshot_id to restore one.`;
        }
        consoleStyler.log('system', `Rolling back to snapshot: ${snapshot_id}...`);
        return await this.manifestManager.restoreSnapshot(snapshot_id);
    }

    async generateC4Diagram(args, c4Visualizer) {
        const { level } = args;
        consoleStyler.log('system', `Generating C4 ${level} diagram...`);
        if (level === 'component') {
            return await c4Visualizer.generateComponentDiagram();
        }
        return "Unsupported diagram level.";
    }

    async buildKnowledgeGraph(args, knowledgeGraphBuilder) {
        consoleStyler.log('system', 'Building knowledge graph...');
        const graph = await knowledgeGraphBuilder.buildGraph();
        return JSON.stringify(graph, null, 2);
    }

    async generateCiCdPipeline(args, cicdArchitect) {
        const { platform } = args;
        consoleStyler.log('system', `Generating CI/CD pipeline for ${platform}...`);
        return await cicdArchitect.generatePipeline(platform);
    }

    async generateDockerConfig(args, containerizationWizard) {
        consoleStyler.log('system', 'Generating Docker configuration...');
        const config = await containerizationWizard.generateConfig();
        if (config.error) return config.error;
        return `Dockerfile:\n${config.dockerfile}\n\n.dockerignore:\n${config.dockerIgnore}\n\ndocker-compose.yml:\n${config.dockerCompose}`;
    }

    async generateApiDocs(args, apiDocSmith) {
        const { target_dir } = args;
        consoleStyler.log('system', `Generating API docs for ${target_dir}...`);
        return await apiDocSmith.generateDocs(target_dir);
    }

    async generateTutorial(args, tutorialGenerator) {
        const { title } = args;
        consoleStyler.log('system', `Generating tutorial: ${title}...`);
        return await tutorialGenerator.generateTutorial(title);
    }

    async generateEnhancements(args, enhancementGenerator) {
        const { category, focus_dirs } = args;
        consoleStyler.log('system', `Generating enhancements (category: ${category})...`);
        const result = await enhancementGenerator.generateEnhancements(category, focus_dirs);
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }

    async implementEnhancements(args, enhancementGenerator) {
        const { enhancements } = args;
        consoleStyler.log('system', `Implementing ${enhancements.length} enhancements...`);
        const result = await enhancementGenerator.implementEnhancements(enhancements);
        return JSON.stringify(result, null, 2);
    }

    async createImplementationPlan(args, implementationPlanner) {
        const { output_file, num_developers = 3 } = args;
        consoleStyler.log('system', `Generating multi-agent implementation plan for ${num_developers} developers...`);
        const result = await implementationPlanner.createExecutionPlan(output_file, num_developers);
        
        if (result.success) {
            // Display summary
            consoleStyler.log('system', `✓ Plan created at ${result.plan_path}`, { box: true });
            consoleStyler.log('system', `Stages: ${result.plan.stages.length}`);
            result.plan.stages.forEach(stage => {
                consoleStyler.log('system', `  Stage ${stage.id}: ${stage.tasks.join(', ')}`, { indent: true });
            });
            return result.message;
        } else {
            return `Failed to create plan: ${result.message}`;
        }
    }

    async executeImplementationPlan(args, planExecutor) {
        const { plan_file = 'implementation-plan.json' } = args;
        
        // Ensure AI Assistant class is available
        if (!planExecutor.AiAssistant) {
             return "Error: AI Assistant class not available for agent execution. This tool requires the system to be initialized with self-replication capabilities.";
        }

        const planPath = path.resolve(this.manifestManager.workingDir, plan_file);
        consoleStyler.log('system', `Executing implementation plan from ${planPath}...`);
        
        const result = await planExecutor.executePlan(planPath);
        
        if (result.success) {
            return `Execution completed successfully. ${result.message}`;
        } else {
            return `Execution failed: ${result.message}`;
        }
    }
}
