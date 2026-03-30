/**
 * ConversationAgent — wraps a promoted conversation as an independent agent.
 *
 * Each ConversationAgent owns a cloned ConversationContext, its own
 * UnifiedProvider instance, and a MemoryBridge that shares workspace-level
 * holographic/pattern memory while maintaining agent-local voluntary and
 * involuntary stores.
 *
 * Lifecycle states: created → running → idle → running → … → terminated
 *                                    ↘ paused → running ↗
 *
 * @module src/core/agent/conversation-agent
 */

import { MemoryBridge } from './memory-bridge.mjs';
import { AssociativeStringStore } from './memory.mjs';
import { createAgentProfile } from '../confidentiality/models.mjs';

/**
 * Promoted conversation agent.
 */
export class ConversationAgent {
  /**
   * @param {Object} opts
   * @param {string} opts.id — unique agent ID (e.g. "agent-researcher-1711740000")
   * @param {string} opts.name — human-readable name
   * @param {import('../conversation-context.mjs').ConversationContext} opts.conversationContext — cloned context
   * @param {MemoryBridge} opts.memoryBridge — wired memory bridge
   * @param {string} opts.parentConversation — name of the originating conversation
   * @param {Object} [opts.agentConfig] — persona, system prompt overlay, tool restrictions
   * @param {Object} [opts.deps] — shared dependencies (aiProvider, toolExecutor, eventBus, etc.)
   * @param {'workspace'|'global'} [opts.visibility='workspace'] — visibility scope
   */
  constructor({ id, name, conversationContext, memoryBridge, parentConversation, agentConfig = {}, deps = {}, visibility = 'workspace' }) {
    /** @type {string} */
    this.id = id;

    /** @type {string} */
    this.name = name;

    /** @type {'created'|'running'|'paused'|'idle'|'terminated'} */
    this.status = 'created';

    /** @type {import('../conversation-context.mjs').ConversationContext} */
    this.conversationContext = conversationContext;

    /** @type {MemoryBridge} */
    this.memoryBridge = memoryBridge;

    /** @type {string} */
    this.parentConversation = parentConversation;

    /** @type {Object} */
    this.agentConfig = agentConfig;

    /**
     * Confidentiality profile for this agent.
     * Defaults to full access (clearanceLevel: 'restricted', allowedCategories: ['*'])
     * for backward compatibility with agents created before the confidentiality system.
     * @type {import('../confidentiality/models.mjs').AgentProfile}
     */
    this.agentProfile = createAgentProfile(agentConfig?.profile);

    /** @type {Object} Shared dependencies */
    this._deps = deps;

    /** @type {Object|null} Own UnifiedProvider instance */
    this._provider = null;

    /** @type {AbortController|null} */
    this._abortController = null;

    /** @type {Array<Function>} Report callbacks */
    this._reportCallbacks = [];

    /** @type {'workspace'|'global'} Visibility scope */
    this.visibility = visibility;

    /** @type {string} ISO timestamp of creation */
    this.createdAt = new Date().toISOString();

    /** @type {string|null} ISO timestamp of last activity */
    this.lastActivity = null;

    /** @type {number} Total messages processed by this agent */
    this.messageCount = 0;
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Initialize the agent's own UnifiedProvider instance.
   * Must be called before start() or sendMessage().
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    // Dynamically import UnifiedProvider to avoid circular dependency
    const { UnifiedProvider } = await import('../agentic/unified/unified-provider.mjs');

    this._provider = new UnifiedProvider();

    // Build agent-scoped deps — shared aiProvider, toolExecutor, eventBus
    // but agent-owned historyManager and memory bridge
    const agentDeps = {
      ...this._deps,
      historyManager: this.conversationContext.historyManager,
      agentProfile: this.agentProfile,  // Confidentiality profile for view compilation
      // Agent events are namespaced via the agent ID
    };

    await this._provider.initialize(agentDeps);
  }

  /**
   * Start autonomous execution with an optional initial instruction.
   *
   * @param {string} [instruction] — initial instruction for the agent
   * @returns {Promise<string>} the agent's response
   */
  async start(instruction) {
    if (this.status === 'terminated') {
      throw new Error(`Agent "${this.id}" has been terminated and cannot be restarted.`);
    }

    if (!this._provider) {
      await this.initialize();
    }

    this.status = 'running';
    this._abortController = new AbortController();
    this.lastActivity = new Date().toISOString();

    if (instruction) {
      return await this._runInstruction(instruction);
    }

    this.status = 'idle';
    return '';
  }

  /**
   * Send a message/instruction to the agent.
   *
   * @param {string} input — user message or instruction
   * @returns {Promise<string>} the agent's response
   */
  async sendMessage(input) {
    if (this.status === 'terminated') {
      throw new Error(`Agent "${this.id}" has been terminated.`);
    }
    if (this.status === 'paused') {
      throw new Error(`Agent "${this.id}" is paused. Resume it first.`);
    }

    if (!this._provider) {
      await this.initialize();
    }

    this.status = 'running';
    this._abortController = new AbortController();
    this.lastActivity = new Date().toISOString();

    return await this._runInstruction(input);
  }

  /**
   * Pause the agent's execution loop.
   */
  pause() {
    if (this.status === 'running') {
      if (this._abortController) {
        this._abortController.abort();
      }
      this.status = 'paused';
      this.lastActivity = new Date().toISOString();
      this._emitStatus();
    }
  }

  /**
   * Resume the agent after being paused.
   */
  resume() {
    if (this.status === 'paused') {
      this.status = 'idle';
      this._abortController = null;
      this.lastActivity = new Date().toISOString();
      this._emitStatus();
    }
  }

  /**
   * Terminate the agent and clean up resources.
   */
  terminate() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this.status = 'terminated';
    this.lastActivity = new Date().toISOString();
    this._provider = null;
    this._emitStatus();
  }

  /**
   * Get the agent's current status and diagnostics.
   *
   * @returns {Object}
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      parentConversation: this.parentConversation,
      messageCount: this.messageCount,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      persona: this.agentConfig?.persona || null,
      visibility: this.visibility,
      memoryDiagnostics: this.memoryBridge?.getDiagnostics() ?? null,
      clearanceLevel: this.agentProfile?.clearanceLevel || 'restricted',
      trustDomain: this.agentProfile?.trustDomain || 'workspace',
    };
  }

  /**
   * Return the agent's conversation history.
   *
   * @returns {Array<Object>}
   */
  getHistory() {
    return this.conversationContext.historyManager.getHistory();
  }

  /**
   * Clear the agent's conversation history (historyManager + aiProviderHistory).
   * Preserves agent identity, memory bridge, experiences, and config.
   */
  clearHistory() {
    if (this.conversationContext.historyManager) {
      this.conversationContext.historyManager.clear();
    }
    this.conversationContext.aiProviderHistory = [];
  }

  /**
   * Register a callback for agent reports.
   *
   * @param {Function} callback — called with (report: string, metadata: Object)
   * @returns {Function} unsubscribe function
   */
  onReport(callback) {
    this._reportCallbacks.push(callback);
    return () => {
      this._reportCallbacks = this._reportCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Serialize the agent state for persistence.
   *
   * @returns {Object}
   */
  serialize() {
    // Ensure the agentConfig includes the profile for persistence
    const config = { ...this.agentConfig };
    if (this.agentProfile) {
      config.profile = { ...this.agentProfile };
    }

    return {
      id: this.id,
      name: this.name,
      status: this.status === 'running' ? 'idle' : this.status, // Running agents restart as idle
      parentConversation: this.parentConversation,
      agentConfig: config,
      visibility: this.visibility,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      messageCount: this.messageCount,
      history: JSON.parse(JSON.stringify(this.conversationContext.historyManager.getHistory())),
      aiProviderHistory: JSON.parse(JSON.stringify(this.conversationContext.aiProviderHistory)),
      experiences: JSON.parse(JSON.stringify(this.conversationContext.experiences)),
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Private
  // ════════════════════════════════════════════════════════════════════

  /**
   * Execute an instruction through the agent's provider.
   *
   * @param {string} input
   * @returns {Promise<string>}
   * @private
   */
  async _runInstruction(input) {
    try {
      const result = await this._provider.run(input, {
        signal: this._abortController?.signal,
        conversationHistory: this.conversationContext.aiProviderHistory,
      });

      const response = typeof result === 'string' ? result : (result?.response || '');
      this.messageCount++;
      this.lastActivity = new Date().toISOString();

      // Report results back
      this._emitReport(response);

      this.status = 'idle';
      this._emitStatus();

      return response;
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        // Expected during pause/terminate — don't change status
        return '';
      }
      this.status = 'idle';
      this.lastActivity = new Date().toISOString();
      throw err;
    }
  }

  /**
   * Emit a report to registered callbacks and the parent conversation.
   *
   * @param {string} report
   * @private
   */
  _emitReport(report) {
    const metadata = {
      agentId: this.id,
      agentName: this.name,
      timestamp: new Date().toISOString(),
    };

    for (const cb of this._reportCallbacks) {
      try {
        cb(report, metadata);
      } catch {
        // Don't let callback errors affect the agent
      }
    }

    // Emit via eventBus if available
    if (this._deps.eventBus) {
      this._deps.eventBus.emit(`agent:${this.id}:report`, {
        agentId: this.id,
        report,
        timestamp: metadata.timestamp,
      });
    }
  }

  /**
   * Emit status change via eventBus.
   * @private
   */
  _emitStatus() {
    if (this._deps.eventBus) {
      this._deps.eventBus.emit(`agent:${this.id}:status`, this.getStatus());
    }
  }
}
