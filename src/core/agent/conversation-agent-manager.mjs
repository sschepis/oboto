/**
 * ConversationAgentManager — registry and lifecycle manager for promoted
 * conversation agents.
 *
 * Handles creation, lookup, lifecycle management (pause/resume/terminate),
 * and persistence of agent metadata to the `.agents/` directory.
 *
 * @module src/core/agent/conversation-agent-manager
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConversationAgent } from './conversation-agent.mjs';
import { MemoryBridge } from './memory-bridge.mjs';
import { AssociativeStringStore } from './memory.mjs';

const AGENTS_DIR = '.agents';
const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.ai-man', 'agents');
const MAX_CONCURRENT_AGENTS = 10;

export class ConversationAgentManager {
  /**
   * @param {Object} opts
   * @param {string} opts.workingDir — workspace root directory
   * @param {Object} [opts.deps] — shared dependencies for agent creation
   */
  constructor({ workingDir, deps = {} }) {
    /** @type {string} */
    this.workingDir = workingDir;

    /** @type {Object} */
    this._deps = deps;

    /** @type {Map<string, ConversationAgent>} */
    this._agents = new Map();

    /** @type {string} */
    this._agentsDir = path.join(workingDir, AGENTS_DIR);

    /** @type {string} */
    this._globalAgentsDir = GLOBAL_AGENTS_DIR;

    /** @type {boolean} Whether the global agents directory is accessible */
    this._globalDirAvailable = false;
  }

  // ════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════

  /**
   * Initialize the manager — ensure the .agents/ directory exists and
   * restore persisted agents.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    await fs.promises.mkdir(this._agentsDir, { recursive: true });

    // Attempt to create and validate the global agents directory
    try {
      await fs.promises.mkdir(this._globalAgentsDir, { recursive: true });
      // Verify write access by touching a temp file
      const testFile = path.join(this._globalAgentsDir, '.access-test');
      await fs.promises.writeFile(testFile, '', 'utf8');
      await fs.promises.unlink(testFile);
      this._globalDirAvailable = true;
    } catch (err) {
      console.warn(`[ConversationAgentManager] Global agents directory not accessible (${this._globalAgentsDir}): ${err.message}. Falling back to workspace-only mode.`);
      this._globalDirAvailable = false;
    }

    await this._restorePersistedAgents();
  }

  /**
   * Update the shared dependencies (called when workspace changes).
   *
   * @param {Object} deps
   */
  updateDeps(deps) {
    this._deps = deps;
  }

  /**
   * Update the working directory (called on workspace switch).
   *
   * @param {string} newDir
   */
  async switchWorkspace(newDir) {
    // Save current agents before switching
    await this.saveAll();

    this.workingDir = newDir;
    this._agentsDir = path.join(newDir, AGENTS_DIR);
    this._agents.clear();

    await this.initialize();
  }

  // ════════════════════════════════════════════════════════════════════
  // Agent CRUD
  // ════════════════════════════════════════════════════════════════════

  /**
   * Create a new promoted conversation agent from a ConversationContext.
   *
   * @param {Object} opts
   * @param {import('../conversation-context.mjs').ConversationContext} opts.conversationContext — the context to clone/transfer
   * @param {string} opts.parentConversation — name of originating conversation
   * @param {string} [opts.agentName] — human-readable name
   * @param {'fork'|'in-place'} [opts.mode='fork'] — promotion mode
   * @param {string} [opts.instruction] — initial instruction
   * @param {string} [opts.persona] — persona/system prompt overlay
   * @param {Object} [opts.toolRestrictions] — tool access restrictions
   * @param {Object} [opts.memorySystem] — shared MemorySystem for memory bridge
   * @param {string} [opts.clearanceLevel] — max sensitivity level ('public'|'internal'|'confidential'|'restricted')
   * @param {string[]} [opts.allowedCategories] — categories the agent is cleared for
   * @param {string[]} [opts.deniedCategories] — explicit deny-list (takes precedence)
   * @param {string} [opts.trustDomain] — namespace for inter-agent trust ('workspace'|'external'|'sandbox')
   * @returns {Promise<{ agentId: string, agentName: string, status: string, parentConversation: string }>}
   */
  async createAgent({
    conversationContext,
    parentConversation,
    agentName,
    mode = 'fork',
    instruction,
    persona,
    toolRestrictions,
    memorySystem,
    clearanceLevel,
    allowedCategories,
    deniedCategories,
    trustDomain,
  }) {
    // Enforce concurrency limit
    const activeCount = [...this._agents.values()].filter(
      a => a.status !== 'terminated'
    ).length;
    if (activeCount >= MAX_CONCURRENT_AGENTS) {
      throw new Error(
        `Maximum concurrent agents (${MAX_CONCURRENT_AGENTS}) reached. Terminate an existing agent first.`
      );
    }

    // Generate unique ID
    const timestamp = Date.now();
    const safeName = (agentName || parentConversation || 'agent')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .substring(0, 50);
    const agentId = `agent-${safeName}-${timestamp}`;
    const name = agentName || `Agent from ${parentConversation}`;

    // Clone or transfer the conversation context
    let agentContext;
    if (mode === 'in-place') {
      // Transfer: the original context is now owned by the agent
      agentContext = conversationContext;
      conversationContext.promotedToAgentId = agentId;
    } else {
      // Fork: deep-clone the context
      agentContext = conversationContext.clone(`agent:${agentId}`);
    }

    // Create agent-local memory stores
    const localVoluntary = new AssociativeStringStore();
    const localInvoluntary = new AssociativeStringStore();

    // Create memory bridge with shared memory system + local stores
    const memBridge = MemoryBridge.forAgent(
      memorySystem || null,
      localVoluntary,
      localInvoluntary
    );

    // Build agent config (including confidentiality profile)
    const agentConfig = {
      persona: persona || null,
      toolRestrictions: toolRestrictions || null,
      mode,
      profile: {
        clearanceLevel: clearanceLevel || 'restricted',
        allowedCategories: allowedCategories || ['*'],
        deniedCategories: deniedCategories || [],
        trustDomain: trustDomain || 'workspace',
      },
    };

    // Create the agent
    const agent = new ConversationAgent({
      id: agentId,
      name,
      conversationContext: agentContext,
      memoryBridge: memBridge,
      parentConversation,
      agentConfig,
      deps: this._deps,
    });

    // Register report callback to forward to parent
    agent.onReport((report, metadata) => {
      if (this._deps.eventBus) {
        this._deps.eventBus.emit('agent:report', {
          agentId,
          agentName: name,
          report,
          parentConversation,
          timestamp: metadata.timestamp,
        });
      }
    });

    // Store in registry
    this._agents.set(agentId, agent);

    // Initialize the agent's provider
    await agent.initialize();

    // Persist agent metadata
    await this._saveAgent(agentId);

    // Start with initial instruction if provided
    if (instruction) {
      // Run async — don't block the promotion response
      agent.start(instruction).catch(err => {
        console.warn(`[ConversationAgentManager] Agent "${agentId}" start failed:`, err.message);
        // Emit startup failure so the UI is informed
        if (this._deps.eventBus) {
          this._deps.eventBus.emit('agent:error', {
            agentId,
            agentName: name,
            error: err.message,
            phase: 'start',
            parentConversation,
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    return {
      agentId,
      agentName: name,
      status: agent.status,
      parentConversation,
    };
  }

  /**
   * Get an agent by ID.
   *
   * @param {string} agentId
   * @returns {ConversationAgent|null}
   */
  getAgent(agentId) {
    return this._agents.get(agentId) || null;
  }

  /**
   * List all agents with summary info.
   *
   * @returns {Array<{ id: string, name: string, status: string, parentConversation: string, messageCount: number }>}
   */
  listAgents() {
    const result = [];
    for (const agent of this._agents.values()) {
      result.push({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        parentConversation: agent.parentConversation,
        messageCount: agent.messageCount,
        createdAt: agent.createdAt,
        lastActivity: agent.lastActivity,
        persona: agent.agentConfig?.persona || null,
        visibility: agent.visibility || 'workspace',
      });
    }
    return result;
  }

  /**
   * Get an agent's conversation history.
   *
   * @param {string} agentId
   * @returns {Array<Object>}
   */
  getAgentHistory(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    return agent.getHistory();
  }

  /**
   * Clear an agent's conversation history.
   *
   * @param {string} agentId
   * @returns {{ agentId: string, success: boolean }}
   */
  clearAgentHistory(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    agent.clearHistory();
    this._saveAgent(agentId).catch(() => {}); // Best-effort persist
    return { agentId, success: true };
  }

  /**
   * Promote a workspace agent to global visibility.
   * Copies the agent JSON to the global directory, updates visibility,
   * and removes the workspace copy.
   *
   * @param {string} agentId
   * @returns {Promise<{ agentId: string, visibility: string }>}
   */
  async promoteToGlobal(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    if (agent.visibility === 'global') {
      return { agentId, visibility: 'global' };
    }
    if (!this._globalDirAvailable) {
      throw new Error('Global agents directory is not accessible. Cannot promote agent.');
    }

    // Update in-memory visibility
    agent.visibility = 'global';

    // Save to global directory
    try {
      const data = agent.serialize();
      const globalFilePath = path.join(this._globalAgentsDir, `${agentId}.json`);
      await fs.promises.writeFile(globalFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // Revert visibility on failure
      agent.visibility = 'workspace';
      throw new Error(`Failed to save agent to global directory: ${err.message}`);
    }

    // Remove from workspace directory (best-effort)
    try {
      const workspaceFilePath = path.join(this._agentsDir, `${agentId}.json`);
      await fs.promises.unlink(workspaceFilePath);
    } catch {
      // File may not exist — that's fine
    }

    return { agentId, visibility: 'global' };
  }

  /**
   * Send a message to an agent.
   *
   * @param {string} agentId
   * @param {string} message
   * @returns {Promise<string>} agent response
   */
  async sendMessage(agentId, message) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    const response = await agent.sendMessage(message);
    await this._saveAgent(agentId);
    return response;
  }

  /**
   * Pause an agent.
   *
   * @param {string} agentId
   * @returns {{ agentId: string, status: string }}
   */
  pauseAgent(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    agent.pause();
    this._saveAgent(agentId).catch(() => {}); // Best-effort persist
    return { agentId, status: agent.status };
  }

  /**
   * Resume a paused agent.
   *
   * @param {string} agentId
   * @returns {{ agentId: string, status: string }}
   */
  resumeAgent(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    agent.resume();
    this._saveAgent(agentId).catch(() => {});
    return { agentId, status: agent.status };
  }

  /**
   * Terminate an agent.
   *
   * @param {string} agentId
   * @returns {{ agentId: string }}
   */
  terminateAgent(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    agent.terminate();
    this._saveAgent(agentId).catch(() => {});
    return { agentId };
  }

  /**
   * Get status/diagnostics for an agent.
   *
   * @param {string} agentId
   * @returns {Object}
   */
  getAgentStatus(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found.`);
    }
    return agent.getStatus();
  }

  // ════════════════════════════════════════════════════════════════════
  // Persistence
  // ════════════════════════════════════════════════════════════════════

  /**
   * Save an agent's state to disk.
   *
   * @param {string} agentId
   * @returns {Promise<void>}
   * @private
   */
  async _saveAgent(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return;

    try {
      // Save to the appropriate directory based on visibility
      const targetDir = agent.visibility === 'global' && this._globalDirAvailable
        ? this._globalAgentsDir
        : this._agentsDir;
      await fs.promises.mkdir(targetDir, { recursive: true });
      const filePath = path.join(targetDir, `${agentId}.json`);
      const data = agent.serialize();
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[ConversationAgentManager] Failed to save agent "${agentId}":`, err.message);
    }
  }

  /**
   * Save all agents to disk.
   *
   * @returns {Promise<void>}
   */
  async saveAll() {
    for (const agentId of this._agents.keys()) {
      await this._saveAgent(agentId);
    }
  }

  /**
   * Restore persisted agents from the .agents/ directory.
   * Agents are restored to 'idle' status (or their persisted status).
   *
   * @returns {Promise<void>}
   * @private
   */
  async _restorePersistedAgents() {
    // Restore from workspace directory
    try {
      const files = await fs.promises.readdir(this._agentsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(this._agentsDir, file);
          const raw = await fs.promises.readFile(filePath, 'utf8');
          const data = JSON.parse(raw);

          // Skip terminated agents
          if (data.status === 'terminated') continue;

          // Ensure workspace visibility for agents in the workspace dir
          data.visibility = data.visibility || 'workspace';

          // Reconstruct the agent from persisted data
          await this._restoreAgent(data);
        } catch (err) {
          console.warn(`[ConversationAgentManager] Failed to restore agent from "${file}":`, err.message);
        }
      }
    } catch {
      // Directory might not exist — that's fine
    }

    // Restore from global directory
    if (this._globalDirAvailable) {
      try {
        const globalFiles = await fs.promises.readdir(this._globalAgentsDir);
        for (const file of globalFiles) {
          if (!file.endsWith('.json')) continue;

          try {
            const filePath = path.join(this._globalAgentsDir, file);
            const raw = await fs.promises.readFile(filePath, 'utf8');
            const data = JSON.parse(raw);

            // Skip terminated agents
            if (data.status === 'terminated') continue;

            // Skip if already restored from workspace (workspace takes precedence for same ID)
            if (this._agents.has(data.id)) continue;

            // Mark as global
            data.visibility = 'global';

            await this._restoreAgent(data);
          } catch (err) {
            console.warn(`[ConversationAgentManager] Failed to restore global agent from "${file}":`, err.message);
          }
        }
      } catch {
        // Global directory read failed — non-critical
      }
    }
  }

  /**
   * Restore a single agent from persisted data.
   *
   * @param {Object} data — serialized agent data
   * @returns {Promise<void>}
   * @private
   */
  async _restoreAgent(data) {
    // Dynamically import to avoid circular deps
    const { ConversationContext } = await import('../conversation-context.mjs');
    const { HistoryManager } = await import('../history-manager.mjs');

    // Reconstruct the HistoryManager
    const hm = new HistoryManager();
    if (data.history && Array.isArray(data.history)) {
      hm.setHistory(data.history, true);
    }

    // Reconstruct the ConversationContext
    const ctx = new ConversationContext(data.id, hm);
    ctx.aiProviderHistory = data.aiProviderHistory || [];
    ctx.experiences = data.experiences || [];

    // Create agent-local memory stores
    const localVoluntary = new AssociativeStringStore();
    const localInvoluntary = new AssociativeStringStore();
    const memBridge = MemoryBridge.forAgent(null, localVoluntary, localInvoluntary);

    const agent = new ConversationAgent({
      id: data.id,
      name: data.name,
      conversationContext: ctx,
      memoryBridge: memBridge,
      parentConversation: data.parentConversation,
      agentConfig: data.agentConfig || {},
      deps: this._deps,
      visibility: data.visibility || 'workspace',
    });

    // Restore metadata
    agent.status = data.status === 'running' ? 'idle' : (data.status || 'idle');
    agent.createdAt = data.createdAt || new Date().toISOString();
    agent.lastActivity = data.lastActivity || null;
    agent.messageCount = data.messageCount || 0;

    // Register report callback
    agent.onReport((report, metadata) => {
      if (this._deps.eventBus) {
        this._deps.eventBus.emit('agent:report', {
          agentId: data.id,
          agentName: data.name,
          report,
          parentConversation: data.parentConversation,
          timestamp: metadata.timestamp,
        });
      }
    });

    this._agents.set(data.id, agent);
  }
}
