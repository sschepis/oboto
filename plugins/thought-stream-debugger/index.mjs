/**
 * Oboto Thought Stream Debugger Plugin
 *
 * Inspect agent reasoning traces and tool execution steps.
 * Ported from notaclaw/plugins/thought-stream-debugger.
 *
 * @module @oboto/plugin-thought-stream-debugger
 */

import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  maxSessions: 100,
  trackAgentSteps: true,
  trackAgentLoopSteps: true,
  trackToolExecutions: true,
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable thought stream debugging', default: true },
  { key: 'maxSessions', label: 'Max Sessions', type: 'number', description: 'Maximum number of debug sessions to retain', default: 100 },
  { key: 'trackAgentSteps', label: 'Track Agent Steps', type: 'boolean', description: 'Record legacy agent:step events', default: true },
  { key: 'trackAgentLoopSteps', label: 'Track Agent Loop Steps', type: 'boolean', description: 'Record agent-loop:step events', default: true },
  { key: 'trackToolExecutions', label: 'Track Tool Executions', type: 'boolean', description: 'Record tool:executed events', default: true },
];

class TraceCollector {
  constructor(maxSessions) {
    this.sessions = new Map();
    this.maxSessions = maxSessions || 100;
  }

  startSession(agentId) {
    // Prune oldest sessions if at capacity
    if (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      this.sessions.delete(oldest);
    }

    const id = 'sess_' + Date.now().toString(36);
    this.sessions.set(id, { 
        id, 
        agentId: agentId || 'system', 
        startTime: Date.now(), 
        status: 'active',
        traces: [] 
    });
    return id;
  }

  logTrace(sessionId, step, details) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.traces.push({ timestamp: Date.now(), step, details });
  }

  endSession(sessionId, status = 'completed') {
      const session = this.sessions.get(sessionId);
      if (session) session.status = status;
  }

  get(sessionId) {
      return this.sessions.get(sessionId);
  }

  list() {
      return Array.from(this.sessions.values()).map(s => ({
          id: s.id,
          agentId: s.agentId,
          startTime: s.startTime,
          status: s.status,
          stepCount: s.traces.length
      }));
  }
  
  findActiveSession(agentId) {
      return Array.from(this.sessions.values())
        .find(s => s.agentId === (agentId || 'system') && s.status === 'active')?.id;
  }
}

export async function activate(api) {
  console.log('[thought-stream-debugger] Activating...');

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'thought-stream-debugger', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
    () => { collector.maxSessions = pluginSettings.maxSessions; }
  );

  const collector = new TraceCollector(pluginSettings.maxSessions);

  // Helper to handle incoming events
  const handleEvent = (stepName, data) => {
      if (!pluginSettings.enabled) return;
      if (!data) return;
      const agentId = data.agentId || data.threadId || 'system';
      
      let sessionId = collector.findActiveSession(agentId);
      if (!sessionId) {
          sessionId = collector.startSession(agentId);
      }
      
      collector.logTrace(sessionId, stepName, data);
  };

  // Listen to system events based on settings
  if (pluginSettings.trackAgentSteps) {
    api.events.onSystem('agent:step', (data) => handleEvent('Agent Step (legacy)', data));
  }
  if (pluginSettings.trackAgentLoopSteps) {
    api.events.onSystem('agent-loop:step', (data) => handleEvent('Agent Loop Step', data));
  }
  if (pluginSettings.trackToolExecutions) {
    api.events.onSystem('tool:executed', (data) => handleEvent('Tool Executed', data));
  }

  // Tool: list_agent_sessions
  api.tools.register({
    useOriginalName: true,
    surfaceSafe: true,
    name: 'list_agent_sessions',
    description: 'Lists all recorded agent sessions',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      return { sessions: collector.list() };
    }
  });

  // Tool: inspect_agent_session
  api.tools.register({
    useOriginalName: true,
    surfaceSafe: true,
    name: 'inspect_agent_session',
    description: 'Retrieves the execution trace for a given agent session',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The ID of the session to inspect' }
      },
      required: ['sessionId']
    },
    handler: async (args) => {
      const session = collector.get(args.sessionId);
      if (!session) throw new Error(`Session ${args.sessionId} not found`);
      return { status: 'success', session };
    }
  });

  console.log('[thought-stream-debugger] Activated.');
}

export async function deactivate(api) {
  console.log('[thought-stream-debugger] Deactivated.');
}
