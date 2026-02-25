export function activate(api) {
  console.log('[Temporal Voyager] Activating...');

  const timeline = [];

  // Hook into the agent loop to record state
  api.events.onSystem('agent-loop:step', (data) => {
    timeline.push({
      id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      data: data
    });
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
      const limit = args.limit || 20;
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

  console.log('[Temporal Voyager] Activated.');
}

export function deactivate(api) {
  console.log('[Temporal Voyager] Deactivated.');
}
