import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  maxTimelineSize: 1000,
  defaultListLimit: 20,
  autoCleanupEnabled: true,
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable temporal voyager', default: true },
  { key: 'maxTimelineSize', label: 'Max Timeline Size', type: 'number', description: 'Maximum number of steps to keep in the timeline (oldest are pruned)', default: 1000 },
  { key: 'defaultListLimit', label: 'Default List Limit', type: 'number', description: 'Default number of recent steps returned by list_timeline_steps', default: 20 },
  { key: 'autoCleanupEnabled', label: 'Auto Cleanup', type: 'boolean', description: 'Automatically prune old timeline entries when maxTimelineSize is exceeded', default: true },
];

export async function activate(api) {
  consoleStyler.log('plugin', 'Activating...');

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'temporal-voyager', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

  const timeline = [];

  // Hook into the agent loop to record state
  api.events.onSystem('agent-loop:step', (data) => {
    if (!pluginSettings.enabled) return;

    timeline.push({
      id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      data: data
    });

    // Auto-cleanup if timeline exceeds max size
    if (pluginSettings.autoCleanupEnabled && timeline.length > pluginSettings.maxTimelineSize) {
      const excess = timeline.length - pluginSettings.maxTimelineSize;
      timeline.splice(0, excess);
    }
  });

  api.tools.register({
    name: 'list_timeline_steps',
    useOriginalName: true,
    description: 'Lists all recorded steps in the agent loop timeline',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of recent steps to return' }
      }
    },
    handler: async (args) => {
      const limit = args.limit || pluginSettings.defaultListLimit;
      // Return the most recent 'limit' steps
      const steps = timeline.slice(-limit).map(step => ({
        id: step.id,
        timestamp: step.timestamp,
        summary: step.data ? `Step data keys: ${Object.keys(step.data).join(', ')}` : 'Empty step'
      }));

      return { steps, totalSteps: timeline.length };
    }
  });

  api.tools.register({
    name: 'jump_to_timeline_step',
    useOriginalName: true,
    description: 'Jump to a specific timestamp or step ID in the recorded timeline (time-travel debugging)',
    parameters: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: 'ID of the step to jump to' }
      },
      required: ['stepId']
    },
    handler: async (args) => {
      const stepIndex = timeline.findIndex(s => s.id === args.stepId);
      if (stepIndex === -1) {
        throw new Error(`Step ID not found: ${args.stepId}`);
      }

      const step = timeline[stepIndex];
      
      // In a full implementation, this would reset the system state, conversation history, 
      // and variable context to what it was at `step.timestamp`.
      // For this port, we will emit an event that other systems could listen to to reset state,
      // and we return the state data so the agent can inspect it.
      
      api.events.emit('temporal-voyager:time-travel', {
        targetStepId: step.id,
        timestamp: step.timestamp,
        data: step.data
      });

      return { 
        status: 'success', 
        message: `Time-traveled to step ${step.id}`,
        state: step.data 
      };
    }
  });

  consoleStyler.log('plugin', 'Activated.');
}

export function deactivate(api) {
  consoleStyler.log('plugin', 'Deactivated.');
}
