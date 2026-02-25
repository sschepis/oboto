/**
 * Oboto Thought Stream Debugger Plugin
 *
 * Inspect agent reasoning traces and tool execution steps.
 * Ported from notaclaw/plugins/thought-stream-debugger.
 *
 * @module @oboto/plugin-thought-stream-debugger
 */

class TraceCollector {
  constructor() {
    this.sessions = new Map();
  }

  startSession(agentId) {
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
  
  const collector = new TraceCollector();

  // Helper to handle incoming events
  const handleEvent = (stepName, data) => {
      if (!data) return;
      const agentId = data.agentId || data.threadId || 'system';
      
      let sessionId = collector.findActiveSession(agentId);
      if (!sessionId) {
          sessionId = collector.startSession(agentId);
      }
      
      collector.logTrace(sessionId, stepName, data);
  };

  // Listen to system events
  api.events.onSystem('agent:step', (data) => handleEvent('Agent Step (legacy)', data));
  api.events.onSystem('agent-loop:step', (data) => handleEvent('Agent Loop Step', data));
  api.events.onSystem('tool:executed', (data) => handleEvent('Tool Executed', data));

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
