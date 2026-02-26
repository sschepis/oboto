import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultAgentTemperature: 0.7,
  defaultAgentSystemPrompt: 'You are a helpful assistant executing a workflow step.',
  seedDemoWorkflow: true,
  verboseLogging: false,
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable workflow weaver', default: true },
  { key: 'defaultAgentTemperature', label: 'Default Agent Temperature', type: 'number', description: 'Default temperature for AI agent steps in workflows', default: 0.7 },
  { key: 'defaultAgentSystemPrompt', label: 'Default Agent System Prompt', type: 'text', description: 'Default system prompt for agent steps', default: 'You are a helpful assistant executing a workflow step.' },
  { key: 'seedDemoWorkflow', label: 'Seed Demo Workflow', type: 'boolean', description: 'Automatically create a demo workflow if none exist', default: true },
  { key: 'verboseLogging', label: 'Verbose Logging', type: 'boolean', description: 'Enable verbose console logging during workflow execution', default: false },
];

export class WorkflowEngine {
  constructor(api, settings) {
    this.api = api;
    this.settings = settings;
    this.stepHandlers = {};
  }

  registerStepType(type, handler) {
    this.stepHandlers[type] = handler;
  }

  async execute(workflow, inputs = {}) {
    if (this.settings.verboseLogging) {
      console.log(`[WorkflowEngine] Starting workflow: ${workflow.id}`);
    }
    const context = { ...inputs };
    const results = {};

    for (const step of workflow.steps) {
      const handler = this.stepHandlers[step.type];
      if (!handler) {
        console.warn(`[WorkflowEngine] Unknown step type: ${step.type}`);
        continue;
      }

      try {
        if (this.settings.verboseLogging) {
          console.log(`[WorkflowEngine] Executing step ${step.id} (${step.type})...`);
        }
        // Resolve inputs from context
        const resolvedParams = this.resolveParams(step.params, context, results);

        const result = await handler(resolvedParams, context);
        results[step.id] = result;

        // Update context if needed
        if (step.outputKey) {
          context[step.outputKey] = result;
        }

      } catch (error) {
        console.error(`[WorkflowEngine] Error in step ${step.id}:`, error);
        throw error;
      }
    }

    return results;
  }

  resolveParams(params, context, results) {
    if (params === undefined || params === null) return params;

    // Handle string reference directly
    if (typeof params === 'string' && params.startsWith('$')) {
      const path = params.substring(1).split('.');
      let current = { ...context, ...results };
      for (const part of path) {
        if (current === undefined || current === null) break;
        current = current[part];
      }
      return current;
    }

    if (typeof params !== 'object') return params;

    // Handle array
    if (Array.isArray(params)) {
      return params.map(p => this.resolveParams(p, context, results));
    }

    const resolved = {};
    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this.resolveParams(value, context, results);
    }
    return resolved;
  }
}

export async function activate(api) {
  console.log('[Workflow Weaver] Activating...');

  // engine is declared here so the onSettingsChange callback can reference it
  let engine;

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'workflow-weaver', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
    () => {
      if (engine) {
        Object.assign(engine.settings, pluginSettings);
      }
    }
  );

  engine = new WorkflowEngine(api, pluginSettings);

  // Register basic step types
  engine.registerStepType('log', async (params) => {
    if (pluginSettings.verboseLogging) {
      console.log('[Workflow Log]', params.message);
    }
    api.events.emit('workflow-weaver:log', { message: params.message });
    return { logged: true };
  });

  engine.registerStepType('tool', async (params) => {
    if (pluginSettings.verboseLogging) {
      console.log(`[Workflow Tool] Calling tool ${params.toolName} with`, params.args);
    }
    try {
      const result = await api.tools.execute(params.toolName, params.args || {});
      return { toolOutput: result };
    } catch (e) {
      console.error(`[Workflow Tool] Error invoking ${params.toolName}:`, e);
      throw e;
    }
  });

  engine.registerStepType('agent', async (params) => {
    if (pluginSettings.verboseLogging) {
      console.log(`[Workflow Agent] Querying agent with: ${params.prompt}`);
    }
    try {
      const response = await api.ai.ask(params.prompt, {
        systemPrompt: params.systemPrompt || pluginSettings.defaultAgentSystemPrompt,
        temperature: params.temperature ?? pluginSettings.defaultAgentTemperature
      });
      return { response };
    } catch (e) {
      console.error(`[Workflow Agent] Error querying agent:`, e);
      throw e;
    }
  });

  // Load existing workflows from storage, or seed a demo if empty
  const getWorkflows = async () => {
    let workflows = await api.storage.get('workflows');
    if (!workflows || Object.keys(workflows).length === 0) {
      if (pluginSettings.seedDemoWorkflow) {
        workflows = {
          'demo-flow': {
            id: 'demo-flow',
            steps: [
              { id: 'step1', type: 'log', params: { message: 'Starting demo workflow' } },
              { id: 'step2', type: 'tool', params: { toolName: 'mcp_filesystem_read_multiple_files', args: { paths: ["package.json"] } } },
              { id: 'step3', type: 'agent', params: { prompt: 'Summarize the package.json file: $step2.toolOutput' } },
              { id: 'step4', type: 'log', params: { message: 'Workflow complete' } }
            ]
          }
        };
        await api.storage.set('workflows', workflows);
      } else {
        workflows = {};
      }
    }
    return workflows;
  };

  api.tools.register({
    name: 'execute_weaved_workflow',
    useOriginalName: true,
    description: 'Executes a defined weaved workflow by ID',
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'ID of the workflow to execute' },
        inputs: { type: 'object', description: 'Input variables for the workflow context' }
      },
      required: ['workflowId']
    },
    handler: async (args) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Workflow Weaver plugin is disabled' };
      }
      const workflows = await getWorkflows();
      const workflow = workflows[args.workflowId];
      if (!workflow) {
        throw new Error(`Workflow ${args.workflowId} not found`);
      }
      const results = await engine.execute(workflow, args.inputs || {});
      return { status: 'success', results };
    }
  });

  api.tools.register({
    name: 'create_weaved_workflow',
    useOriginalName: true,
    description: 'Creates or updates a weaved workflow definition',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID for the workflow' },
        definition: { 
          type: 'object',
          description: 'The workflow definition containing the steps array. E.g. { steps: [{ id, type, params, outputKey }] }'
        }
      },
      required: ['id', 'definition']
    },
    handler: async (args) => {
      const workflows = await getWorkflows();
      workflows[args.id] = { ...args.definition, id: args.id };
      await api.storage.set('workflows', workflows);
      return { status: 'created', id: args.id };
    }
  });

  api.tools.register({
    name: 'list_weaved_workflows',
    useOriginalName: true,
    description: 'Lists all defined weaved workflows',
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      const workflows = await getWorkflows();
      return { 
        workflows: Object.values(workflows).map(w => ({
          id: w.id,
          stepsCount: w.steps ? w.steps.length : 0
        })) 
      };
    }
  });

  console.log('[Workflow Weaver] Activated.');
}

export function deactivate(api) {
  console.log('[Workflow Weaver] Deactivated.');
}
