/**
 * TaskRouter — multi-agent task routing with confidentiality-aware agent selection.
 *
 * Sits alongside `ConversationAgentManager` and orchestrates multi-agent
 * workflows by decomposing tasks, matching them to eligible agents based on
 * `AgentProfile` clearance rules, auto-creating agents when none qualify,
 * and executing the resulting `TaskGraph`.
 *
 * @module src/core/confidentiality/task-router
 */

import {
  SENSITIVITY_RANK,
  compareSensitivity,
  maxSensitivity,
  isClearedForLevel,
  isClearedForCategories,
  checkClearance,
  createSensitivityMap,
  createSourceArtifact,
  createAgentProfile,
} from './models.mjs';
import { TaskGraph, createTaskNode } from './task-graph.mjs';

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/** Maximum agents auto-created per single routing operation. */
const DEFAULT_MAX_AUTO_CREATED = 3;

// ════════════════════════════════════════════════════════════════════════
// TaskRouter
// ════════════════════════════════════════════════════════════════════════

export class TaskRouter {
  /**
   * @param {Object} opts
   * @param {import('../agent/conversation-agent-manager.mjs').ConversationAgentManager} opts.agentManager
   * @param {import('./policy-engine.mjs').PolicyEngine} opts.policyEngine
   * @param {import('./sensitivity-tagger.mjs').SensitivityTagger} opts.tagger
   * @param {Object}  [opts.mergeController]  — optional MergeController (Phase 5)
   * @param {Object}  [opts.routingConfig]    — routing configuration overrides
   * @param {boolean} [opts.routingConfig.autoCreateAgents=true]
   * @param {number}  [opts.routingConfig.maxAutoCreatedAgents=3]
   */
  constructor({ agentManager, policyEngine, tagger, mergeController, routingConfig = {} }) {
    if (!agentManager) {
      throw new Error('[TaskRouter] agentManager is required');
    }
    if (!policyEngine) {
      throw new Error('[TaskRouter] policyEngine is required');
    }
    if (!tagger) {
      throw new Error('[TaskRouter] tagger is required');
    }

    /** @type {import('../agent/conversation-agent-manager.mjs').ConversationAgentManager} */
    this._agentManager = agentManager;

    /** @type {import('./policy-engine.mjs').PolicyEngine} */
    this._policyEngine = policyEngine;

    /** @type {import('./sensitivity-tagger.mjs').SensitivityTagger} */
    this._tagger = tagger;

    /** @type {Object|null} */
    this._mergeController = mergeController || null;

    /** @type {boolean} */
    this._autoCreateAgents = routingConfig.autoCreateAgents !== false;

    /** @type {number} */
    this._maxAutoCreated = routingConfig.maxAutoCreatedAgents ?? DEFAULT_MAX_AUTO_CREATED;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Main routing API
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Decompose a task into subtasks, route each to an eligible agent,
   * execute the task graph, and merge results.
   *
   * @param {Object} task
   * @param {string} task.instruction — the user's original instruction
   * @param {import('./models.mjs').SourceArtifact[]} task.artifacts — input artifacts with sensitivity
   * @param {import('./models.mjs').AgentProfile} task.requesterProfile — profile of the requesting agent/user
   * @param {Object}  [task.constraints] — optional routing constraints
   * @param {string}  [task.constraints.trustDomain] — restrict to agents in this trust domain
   * @param {boolean} [task.constraints.localOnly] — restrict to agents with localOnly provider
   * @param {import('./task-graph.mjs').TaskNode[]} [task.subtasks] — pre-decomposed subtasks (Mode A)
   * @returns {Promise<import('./task-graph.mjs').TaskGraphResult>}
   */
  async route(task) {
    const { instruction, artifacts = [], requesterProfile, constraints = {}, subtasks } = task;
    const routeState = { autoCreatedCount: 0 };

    // ── Step 1: Build the task graph ───────────────────────────────────
    let nodes;
    if (subtasks && subtasks.length > 0) {
      // Mode A — explicit decomposition: caller provides subtask nodes
      nodes = subtasks.map(st => createTaskNode(st));
    } else {
      // Single-node graph: route the whole instruction as one task
      const aggregateSensitivity = this._computeAggregateSensitivity(artifacts);
      nodes = [
        createTaskNode({
          instruction,
          inputArtifactIds: artifacts.map(a => a.id),
          requiredClearance: aggregateSensitivity,
        }),
      ];
    }

    const graph = new TaskGraph(nodes);

    // ── Step 2: Assign agents to each node ────────────────────────────
    for (const node of graph.getAllNodes()) {
      const assigned = await this._assignAgent(node, constraints, routeState);
      if (!assigned) {
        // If we can't assign an agent even after auto-create attempt, mark it
        node.error = 'No eligible agent found and auto-creation exhausted or disabled';
      }
    }

    // ── Step 3: Execute the graph ─────────────────────────────────────
    const result = await graph.execute(async (node) => {
      if (!node.assignedAgentId) {
        throw new Error('No agent assigned to this node');
      }

      const agent = this._agentManager.getAgent(node.assignedAgentId);
      if (!agent) {
        throw new Error(`Assigned agent "${node.assignedAgentId}" not found`);
      }

      // Execute the subtask via the agent
      const response = await this._executeOnAgent(agent, node, artifacts);
      return response;
    });

    // ── Step 4: Merge (if merge controller available) ─────────────────
    if (this._mergeController && result.outputs.length > 1) {
      try {
        return await this._mergeController.merge(result, requesterProfile);
      } catch (err) {
        // Fall through to raw result if merge fails
        result.errors.push(`Merge failed: ${err.message}`);
      }
    }

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Agent selection
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Find agents eligible to handle content at a given sensitivity level
   * and set of categories.
   *
   * Selection criteria (per §4.6 of the design):
   *   1. Clearance filter: agent clearanceLevel >= requiredClearance level
   *   2. Category filter:  required categories ⊆ (agent allowed ∖ agent denied)
   *   3. Trust domain filter: if constraint specified, agent trustDomain must match
   *   4. Provider constraints: if localOnly required, agent must have localOnly
   *   5. Load balancing: prefer idle agents over running ones
   *   6. Specialization score: (future — currently stub)
   *
   * @param {string}   sensitivityLevel  — minimum clearance level required
   * @param {string[]} categories        — categories the agent must be cleared for
   * @param {Object}   [constraints]     — additional routing constraints
   * @param {string}   [constraints.trustDomain]
   * @param {boolean}  [constraints.localOnly]
   * @returns {import('../agent/conversation-agent.mjs').ConversationAgent[]}
   */
  findEligibleAgents(sensitivityLevel, categories = [], constraints = {}) {
    const allAgents = this._agentManager.listAgents();
    const eligible = [];

    for (const agentInfo of allAgents) {
      // Skip terminated agents
      if (agentInfo.status === 'terminated') continue;

      const agent = this._agentManager.getAgent(agentInfo.id);
      if (!agent) continue;

      const profile = agent.agentProfile || createAgentProfile();

      // ① Clearance level filter
      if (!isClearedForLevel(profile, sensitivityLevel)) continue;

      // ② Category filter
      if (!isClearedForCategories(profile, categories)) continue;

      // ③ Trust domain filter
      if (constraints.trustDomain && profile.trustDomain !== constraints.trustDomain) continue;

      // ④ Provider constraints (localOnly)
      if (constraints.localOnly && !profile.providerConstraints?.localOnly) continue;

      eligible.push(agent);
    }

    // ⑤ Load balancing: sort idle agents first, then created, then running, then paused
    const statusPriority = { idle: 0, created: 1, running: 2, paused: 3 };
    eligible.sort((a, b) => {
      const pa = statusPriority[a.status] ?? 4;
      const pb = statusPriority[b.status] ?? 4;
      return pa - pb;
    });

    return eligible;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Assign an agent to a task node. If no eligible agent exists and
   * auto-creation is enabled, creates one via ConversationAgentManager.
   *
   * @param {import('./task-graph.mjs').TaskNode} node
   * @param {Object} constraints
   * @returns {Promise<boolean>} true if an agent was assigned
   * @private
   */
  async _assignAgent(node, constraints, routeState) {
    const clearance = node.requiredClearance || createSensitivityMap();

    // Look for existing eligible agents
    const eligible = this.findEligibleAgents(
      clearance.level,
      clearance.categories,
      constraints,
    );

    if (eligible.length > 0) {
      // Pick the best-fit agent (first in sorted list — idle preferred)
      node.assignedAgentId = eligible[0].id;
      return true;
    }

    // No eligible agent — attempt auto-creation
    if (!this._autoCreateAgents) {
      return false;
    }
    if (routeState.autoCreatedCount >= this._maxAutoCreated) {
      return false;
    }

    try {
      const created = await this._autoCreateAgent(node, constraints);
      if (created) {
        node.assignedAgentId = created.agentId;
        routeState.autoCreatedCount++;
        return true;
      }
    } catch (err) {
      // Auto-creation failed (e.g. max concurrent agents reached)
      node.error = `Auto-create failed: ${err.message}`;
    }

    return false;
  }

  /**
   * Auto-create a new agent with the clearance required by a task node.
   *
   * Uses `ConversationAgentManager.createAgent()` with a synthetic
   * conversation context cloned from any existing agent, or a minimal
   * stub if no agents exist.
   *
   * @param {import('./task-graph.mjs').TaskNode} node
   * @param {Object} constraints
   * @returns {Promise<{ agentId: string, agentName: string }|null>}
   * @private
   */
  async _autoCreateAgent(node, constraints) {
    const clearance = node.requiredClearance || createSensitivityMap();

    // Find a donor agent to clone context from
    const allAgents = this._agentManager.listAgents();
    let donorAgent = null;
    for (const info of allAgents) {
      if (info.status === 'terminated') continue;
      const agent = this._agentManager.getAgent(info.id);
      if (agent && agent.conversationContext) {
        donorAgent = agent;
        break;
      }
    }

    if (!donorAgent || !donorAgent.conversationContext) {
      // Cannot auto-create without a conversation context to clone
      return null;
    }

    const agentName = `auto-${clearance.level}-${Date.now()}`;

    const result = await this._agentManager.createAgent({
      conversationContext: donorAgent.conversationContext,
      parentConversation: donorAgent.parentConversation || 'task-router',
      agentName,
      mode: 'fork',
      persona: `Specialized agent with ${clearance.level} clearance for task routing.`,
      clearanceLevel: clearance.level,
      allowedCategories: clearance.categories.length > 0 ? clearance.categories : ['*'],
      deniedCategories: [],
      trustDomain: constraints.trustDomain || 'workspace',
    });

    return result;
  }

  /**
   * Execute a subtask instruction on the assigned agent.
   *
   * Sends the node's instruction to the agent and wraps the response
   * as a `SourceArtifact`.
   *
   * @param {import('../agent/conversation-agent.mjs').ConversationAgent} agent
   * @param {import('./task-graph.mjs').TaskNode} node
   * @param {import('./models.mjs').SourceArtifact[]} inputArtifacts
   * @returns {Promise<import('./models.mjs').SourceArtifact>}
   * @private
   */
  async _executeOnAgent(agent, node, inputArtifacts) {
    // Build context from input artifacts relevant to this node
    const relevantArtifacts = inputArtifacts.filter(
      a => node.inputArtifactIds.includes(a.id)
    );

    // Compose the instruction with any relevant artifact content
    let fullInstruction = node.instruction;
    if (relevantArtifacts.length > 0) {
      const contextBlock = relevantArtifacts
        .map(a => `--- Artifact ${a.id} (${a.type}) ---\n${a.content}`)
        .join('\n\n');
      fullInstruction = `${node.instruction}\n\nContext:\n${contextBlock}`;
    }

    // Send to agent — use the agent's sendMessage or start method
    let responseContent = '';
    if (typeof agent.sendMessage === 'function') {
      const response = await agent.sendMessage(fullInstruction);
      responseContent = typeof response === 'string'
        ? response
        : (response?.content || response?.text || JSON.stringify(response));
    } else if (typeof agent.start === 'function') {
      await agent.start(fullInstruction);
      responseContent = `[Task dispatched to agent ${agent.id}]`;
    } else {
      throw new Error(`Agent "${agent.id}" has no sendMessage or start method`);
    }

    // Classify the output and wrap as SourceArtifact
    const outputSensitivity = this._tagger.classify(responseContent, 'agent-output');

    return createSourceArtifact({
      content: responseContent,
      type: 'agent-output',
      agentId: agent.id,
      sensitivity: outputSensitivity,
      lineage: {
        parentIds: node.inputArtifactIds,
        derivationType: 'llm-derived',
        agentId: agent.id,
      },
    });
  }

  /**
   * Compute the aggregate sensitivity across a set of artifacts.
   * Uses ceiling semantics: level = max level, categories = union.
   *
   * @param {import('./models.mjs').SourceArtifact[]} artifacts
   * @returns {import('./models.mjs').SensitivityMap}
   * @private
   */
  _computeAggregateSensitivity(artifacts) {
    if (!artifacts || artifacts.length === 0) {
      return createSensitivityMap();
    }

    let level = 'public';
    const categoriesSet = new Set();

    for (const artifact of artifacts) {
      const s = artifact.sensitivity || {};
      level = maxSensitivity(level, s.level || 'public');
      for (const cat of (s.categories || [])) {
        categoriesSet.add(cat);
      }
    }

    return createSensitivityMap({
      level,
      categories: [...categoriesSet],
    });
  }
}
