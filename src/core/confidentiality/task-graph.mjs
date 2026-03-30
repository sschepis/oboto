/**
 * TaskGraph — DAG execution engine for multi-agent confidentiality-aware routing.
 *
 * Models a directed acyclic graph of subtasks (`TaskNode`s) with dependency
 * edges, executes them in topological order (parallelising independent nodes),
 * and collects their output artifacts.
 *
 * @module src/core/confidentiality/task-graph
 */

import crypto from 'crypto';
import { createSensitivityMap } from './models.mjs';

// ════════════════════════════════════════════════════════════════════════
// TaskNode helpers
// ════════════════════════════════════════════════════════════════════════

/**
 * Valid node statuses.
 * @type {string[]}
 */
export const NODE_STATUSES = ['pending', 'running', 'completed', 'failed', 'skipped'];

/**
 * Create a TaskNode with defaults.
 *
 * @param {Partial<import('../../plans/confidentiality-routing-design.md').TaskNode>} overrides
 * @returns {import('../../plans/confidentiality-routing-design.md').TaskNode}
 */
export function createTaskNode(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    instruction: overrides.instruction || '',
    inputArtifactIds: overrides.inputArtifactIds || [],
    dependsOn: overrides.dependsOn || [],
    assignedAgentId: overrides.assignedAgentId || null,
    requiredClearance: overrides.requiredClearance || createSensitivityMap(),
    status: overrides.status || 'pending',
    output: overrides.output || null,
    error: overrides.error || null,
  };
}

// ════════════════════════════════════════════════════════════════════════
// TaskGraphResult
// ════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} TaskGraphResult
 * @property {boolean}    success   — true if all nodes completed
 * @property {TaskNode[]} nodes     — final state of every node
 * @property {import('./models.mjs').SourceArtifact[]} outputs — output artifacts from leaf nodes
 * @property {string[]}   errors    — human-readable error descriptions
 * @property {number}     durationMs — wall-clock execution time in milliseconds
 */

// ════════════════════════════════════════════════════════════════════════
// TaskGraph
// ════════════════════════════════════════════════════════════════════════

export class TaskGraph {
  /**
   * @param {TaskNode[]} nodes — the set of task nodes forming the DAG
   */
  constructor(nodes = []) {
    /** @type {Map<string, TaskNode>} */
    this._nodes = new Map();

    for (const raw of nodes) {
      const node = createTaskNode(raw);
      this._nodes.set(node.id, node);
    }

    // Validate DAG on construction
    this._validateAcyclic();
  }

  // ──────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Add a node to the graph.
   *
   * @param {Partial<TaskNode>} nodeData
   * @returns {TaskNode} the normalised node
   */
  addNode(nodeData) {
    const node = createTaskNode(nodeData);
    if (this._nodes.has(node.id)) {
      throw new Error(`[TaskGraph] Duplicate node id "${node.id}"`);
    }
    this._nodes.set(node.id, node);
    // Re-validate after mutation
    this._validateAcyclic();
    return node;
  }

  /**
   * Retrieve a node by ID.
   *
   * @param {string} nodeId
   * @returns {TaskNode|null}
   */
  getNode(nodeId) {
    return this._nodes.get(nodeId) || null;
  }

  /**
   * Return all nodes.
   *
   * @returns {TaskNode[]}
   */
  getAllNodes() {
    return [...this._nodes.values()];
  }

  /**
   * Return the number of nodes.
   *
   * @returns {number}
   */
  get size() {
    return this._nodes.size;
  }

  /**
   * Get all leaf nodes whose dependencies have been satisfied
   * (i.e. all upstream nodes are 'completed') and that are still 'pending'.
   *
   * @returns {TaskNode[]}
   */
  getReadyNodes() {
    const ready = [];
    for (const node of this._nodes.values()) {
      if (node.status !== 'pending') continue;
      if (this._dependenciesSatisfied(node)) {
        ready.push(node);
      }
    }
    return ready;
  }

  /**
   * Mark a node as completed with its output artifact.
   *
   * @param {string} nodeId
   * @param {import('./models.mjs').SourceArtifact} output
   */
  completeNode(nodeId, output) {
    const node = this._nodes.get(nodeId);
    if (!node) throw new Error(`[TaskGraph] Node "${nodeId}" not found`);
    node.status = 'completed';
    node.output = output;
  }

  /**
   * Mark a node as failed.
   *
   * @param {string} nodeId
   * @param {string} errorMessage
   */
  failNode(nodeId, errorMessage) {
    const node = this._nodes.get(nodeId);
    if (!node) throw new Error(`[TaskGraph] Node "${nodeId}" not found`);
    node.status = 'failed';
    node.error = errorMessage;

    // Skip all transitive dependents
    this._skipDependents(nodeId);
  }

  /**
   * Execute the graph, respecting dependencies and agent assignment.
   * Nodes at the same depth level can execute in parallel.
   *
   * @param {Function} executor — async (node: TaskNode) => SourceArtifact
   *   Called for each ready node. Must return the output artifact.
   * @returns {Promise<TaskGraphResult>}
   */
  async execute(executor) {
    if (typeof executor !== 'function') {
      throw new TypeError('[TaskGraph] executor must be a function');
    }

    const startTime = Date.now();
    const errors = [];

    // Iterative breadth-first execution
    while (true) {
      const ready = this.getReadyNodes();
      if (ready.length === 0) break;

      // Mark all ready nodes as running
      for (const node of ready) {
        node.status = 'running';
      }

      // Execute all ready nodes in parallel
      const results = await Promise.allSettled(
        ready.map(async (node) => {
          try {
            const output = await executor(node);
            this.completeNode(node.id, output);
          } catch (err) {
            const msg = err?.message || String(err);
            errors.push(`Node "${node.id}": ${msg}`);
            this.failNode(node.id, msg);
          }
        })
      );

      // Check for unexpected rejections in Promise.allSettled
      for (const r of results) {
        if (r.status === 'rejected') {
          errors.push(`Unexpected rejection: ${r.reason}`);
        }
      }
    }

    // Collect outputs from completed leaf nodes (nodes with no dependents)
    const outputs = [];
    const allNodes = this.getAllNodes();
    const dependentOf = new Set();
    for (const node of allNodes) {
      for (const dep of node.dependsOn) {
        dependentOf.add(dep);
      }
    }

    for (const node of allNodes) {
      if (node.status === 'completed' && node.output) {
        outputs.push(node.output);
      }
    }

    const success = allNodes.every(
      n => n.status === 'completed' || n.status === 'skipped'
    );

    return {
      success,
      nodes: allNodes,
      outputs,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Check whether all dependencies of a node are completed.
   *
   * @param {TaskNode} node
   * @returns {boolean}
   * @private
   */
  _dependenciesSatisfied(node) {
    for (const depId of node.dependsOn) {
      const dep = this._nodes.get(depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  /**
   * Skip all nodes that transitively depend on the given failed node.
   *
   * @param {string} failedNodeId
   * @private
   */
  _skipDependents(failedNodeId) {
    for (const node of this._nodes.values()) {
      if (node.status !== 'pending') continue;
      if (this._transitivelyDependsOn(node.id, failedNodeId, new Set())) {
        node.status = 'skipped';
        node.error = `Skipped: upstream node "${failedNodeId}" failed`;
      }
    }
  }

  /**
   * Check if nodeId transitively depends on targetId.
   *
   * @param {string} nodeId
   * @param {string} targetId
   * @param {Set<string>} visited — cycle guard
   * @returns {boolean}
   * @private
   */
  _transitivelyDependsOn(nodeId, targetId, visited) {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);

    const node = this._nodes.get(nodeId);
    if (!node) return false;

    for (const depId of node.dependsOn) {
      if (depId === targetId) return true;
      if (this._transitivelyDependsOn(depId, targetId, visited)) return true;
    }
    return false;
  }

  /**
   * Validate that the graph is acyclic via topological sort (Kahn's algorithm).
   * Throws if a cycle is detected.
   *
   * @private
   */
  _validateAcyclic() {
    if (this._nodes.size === 0) return;

    // Build in-degree map and reverse adjacency map (dependency → dependents)
    // This makes Kahn's algorithm O(V+E) instead of O(V²).
    const inDegree = new Map();
    const dependents = new Map();

    for (const node of this._nodes.values()) {
      if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
      if (!dependents.has(node.id)) dependents.set(node.id, []);

      for (const depId of node.dependsOn) {
        // Validate that dependency exists
        if (!this._nodes.has(depId)) {
          throw new Error(
            `[TaskGraph] Node "${node.id}" depends on "${depId}" which does not exist in the graph`
          );
        }
        // Build reverse adjacency: depId → [node.id, ...]
        if (!dependents.has(depId)) dependents.set(depId, []);
        dependents.get(depId).push(node.id);
      }

      // In-degree of node.id = number of its dependencies
      inDegree.set(node.id, node.dependsOn.length);
    }

    // Queue all nodes with in-degree 0
    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      visited++;

      // For each node that depends on `current`, decrement its in-degree
      for (const depId of dependents.get(current) || []) {
        const newDeg = inDegree.get(depId) - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) {
          queue.push(depId);
        }
      }
    }

    if (visited !== this._nodes.size) {
      throw new Error(
        `[TaskGraph] Cycle detected in task graph. ` +
        `Processed ${visited} of ${this._nodes.size} nodes.`
      );
    }
  }
}
