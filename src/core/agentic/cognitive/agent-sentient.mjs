/**
 * agent-sentient.mjs — Sentient/cognitive subsystem methods extracted from CognitiveAgent.
 *
 * Handles SentientCognitiveCore initialization, state persistence,
 * sentient tool metadata, and sentient tool execution.
 *
 * Each function takes `agent` (CognitiveAgent instance) as the first parameter.
 *
 * @module src/core/agentic/cognitive/agent-sentient
 */

import { z } from 'zod';
import { checkSentientAvailability } from './sentient-bridge.mjs';
import { isPathWithinRoot } from '../../../lib/path-validation.mjs';
import { emitStatus } from '../../status-reporter.mjs';

/**
 * Initialize the SentientCognitiveCore, replacing the lightweight CognitiveCore.
 * Called by CognitiveProvider.initialize() after construction when sentient
 * mode is enabled.  Uses dynamic import to avoid top-level dependency on
 * the sentient-cognitive-core module.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {Object} [options]
 * @param {import('events').EventEmitter} [options.eventBus]
 * @param {string} [options.workingDir]
 * @returns {Promise<boolean>} true if sentient core was initialized successfully
 */
export async function initSentientCore(agent, options = {}) {
  if (!agent._sentientPending) return false;

  // Check availability of sentient-core.js and @aleph-ai/tinyaleph
  const availability = checkSentientAvailability();
  if (!availability.available) {
    console.warn(`[CognitiveAgent] Sentient mode requested but unavailable: ${availability.error}. Using lightweight CognitiveCore.`);
    agent._sentientPending = false;
    return false;
  }

  try {
    const { SentientCognitiveCore } = await import('./sentient-cognitive-core.mjs');

    const sentientConfig = {
      ...agent.config.sentient,
      eventBus: options.eventBus || agent.eventBus,
    };

    // Resolve memory path to workspace directory
    if (!sentientConfig.memoryPath && options.workingDir) {
      const { resolve } = await import('path');
      sentientConfig.memoryPath = resolve(
        options.workingDir, '.ai-man', 'sentient-memory'
      );
    }

    // Validate user-supplied memoryPath stays within the workspace
    if (sentientConfig.memoryPath && options.workingDir) {
      const { resolve } = await import('path');
      const resolvedMemPath = resolve(sentientConfig.memoryPath);
      const resolvedWorkDir = resolve(options.workingDir);
      if (!(await isPathWithinRoot(resolvedMemPath, resolvedWorkDir))) {
        console.warn('[CognitiveAgent] memoryPath traverses outside workspace — ignoring');
        sentientConfig.memoryPath = resolve(resolvedWorkDir, '.ai-man', 'sentient-memory');
      }
    }

    const sentientCore = new SentientCognitiveCore(sentientConfig);

    // Await async initialisation (SMF axis label import) so
    // the first getStateContext() call returns proper labels.
    await sentientCore.ensureReady();

    // Load persisted state if available
    if (sentientConfig.statePersistence) {
      await loadSentientState(agent, sentientCore, sentientConfig, options.workingDir);
    }

    // Replace the placeholder CognitiveCore
    agent.cognitive = sentientCore;
    agent._sentientEnabled = true;
    agent._sentientPending = false;

    console.log('[CognitiveAgent] SentientCognitiveCore initialized successfully');
    return true;
  } catch (err) {
    console.warn('[CognitiveAgent] Failed to init SentientCognitiveCore:', err.message);
    agent._sentientPending = false;
    return false;
  }
}

/**
 * Load persisted sentient state from disk.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {Object} sentientCore - SentientCognitiveCore instance
 * @param {Object} sentientConfig - Sentient configuration
 * @param {string} [workingDir] - Workspace root directory
 */
export async function loadSentientState(agent, sentientCore, sentientConfig, workingDir) {
  try {
    const { resolve } = await import('path');
    const { readFile } = await import('fs/promises');
    const statePath = sentientConfig.statePath
      || (workingDir && resolve(workingDir, '.ai-man', 'sentient-state.json'));
    if (!statePath) return;

    // Validate that statePath is within the workspace
    if (workingDir && !(await isPathWithinRoot(resolve(statePath), resolve(workingDir)))) {
      console.warn('[CognitiveAgent] statePath traverses outside workspace — skipping load');
      return;
    }

    const data = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(data);
    sentientCore.loadFromJSON(parsed);
    console.log('[CognitiveAgent] Loaded sentient state from', statePath);
  } catch (e) {
    // ENOENT is expected (no persisted state yet) — anything else
    // (corrupted JSON, permission errors) deserves a warning so users
    // know their state file has a problem.
    if (e.code !== 'ENOENT') {
      console.warn('[CognitiveAgent] Failed to load sentient state:', e.message);
    }
  }
}

/**
 * Save sentient state to disk.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @returns {Promise<void>}
 */
export async function saveSentientState(agent) {
  if (!agent._sentientEnabled || !agent.cognitive.toJSON) return;

  try {
    const { resolve } = await import('path');
    const { writeFile, mkdir } = await import('fs/promises');
    const statePath = agent.config.sentient?.statePath
      || (agent.workingDir && resolve(agent.workingDir, '.ai-man', 'sentient-state.json'));
    if (!statePath) return;

    // Validate that statePath is within the workspace to prevent path traversal
    if (agent.workingDir && !(await isPathWithinRoot(resolve(statePath), resolve(agent.workingDir)))) {
      console.warn('[CognitiveAgent] statePath traverses outside workspace — skipping save');
      return;
    }

    // Ensure directory exists
    const dir = resolve(statePath, '..');
    await mkdir(dir, { recursive: true });

    const data = JSON.stringify(agent.cognitive.toJSON());

    // Guard against unbounded state growth
    const MAX_STATE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (data.length > MAX_STATE_SIZE) {
      console.warn(`[CognitiveAgent] Sentient state too large (${(data.length / 1024 / 1024).toFixed(1)} MB) — skipping save`);
      return;
    }

    await writeFile(statePath, data, 'utf-8');
  } catch (err) {
    console.warn('[CognitiveAgent] Failed to save sentient state:', err.message);
  }
}

/**
 * Single source of truth for sentient tool metadata.
 * Returns an array of { name, description, zodSchema, openAiSchema } objects
 * used by _getLmscriptTools(), _getToolDefinitions(), and _executeSentientTool().
 *
 * @returns {Array<{name: string, description: string, zodSchema: import('zod').ZodType, openAiSchema: Object}>}
 */
export function getSentientToolMetadata() {
  return [
    {
      name: 'sentient_introspect',
      description: 'Deep introspection of the sentient observer — returns PRSC oscillator phases, SMF field state, agency goals, boundary integrity, temporal perception, entanglement links, and holographic encoder status',
      zodSchema: z.object({}),
      openAiSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'sentient_adaptive_process',
      description: 'Process text through the sentient observer using Adaptive Coherence Tracking (ACT) — iteratively processes until coherence stabilizes, returning richer analysis than standard processInput',
      zodSchema: z.object({
        text: z.string().describe('Text to process adaptively'),
        maxSteps: z.number().optional().describe('Maximum ACT iterations (default: 50)'),
        coherenceThreshold: z.number().optional().describe('Coherence threshold to stop (default: 0.7)'),
      }),
      openAiSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to process adaptively' },
          maxSteps: { type: 'number', description: 'Maximum ACT iterations (default: 50)' },
          coherenceThreshold: { type: 'number', description: 'Coherence threshold to stop (default: 0.7)' },
        },
        required: ['text'],
      },
    },
    {
      name: 'sentient_set_goal',
      description: 'Create a goal in the sentient observer\'s agency layer — goals influence attention allocation and processing priorities',
      zodSchema: z.object({
        description: z.string().describe('Goal description'),
        priority: z.number().optional().describe('Goal priority 0-1 (default: 0.5)'),
      }),
      openAiSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Goal description' },
          priority: { type: 'number', description: 'Goal priority 0-1 (default: 0.5)' },
        },
        required: ['description'],
      },
    },
    {
      name: 'sentient_memory_search',
      description: 'Search the sentient observer\'s holographic memory field (SMF) by similarity — uses sedenion-based similarity matching for deeper semantic recall than standard recall_memory',
      zodSchema: z.object({
        query: z.string().describe('Search query text'),
        limit: z.number().optional().describe('Max results (default: 5)'),
      }),
      openAiSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          limit: { type: 'number', description: 'Max results (default: 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'sentient_evolution_snapshot',
      description: 'Capture a snapshot of the sentient observer\'s evolution stream — shows cognitive evolution trajectory, coherence history, and emergent patterns over time',
      zodSchema: z.object({}),
      openAiSchema: { type: 'object', properties: {}, required: [] },
    },
  ];
}

/**
 * Shared execution logic for all sentient-specific tools.
 * Called from _getLmscriptTools() execute callbacks, _executeTool(), and
 * any future tool dispatch paths.
 *
 * @param {import('./agent.mjs').CognitiveAgent} agent
 * @param {string} name - Sentient tool name (e.g. 'sentient_introspect')
 * @param {Object} args - Parsed tool arguments
 * @returns {Object|null} Tool result object, or null if name is not a sentient tool
 */
export function executeSentientTool(agent, name, args = {}) {
  switch (name) {
    case 'sentient_introspect': {
      emitStatus('Deep sentient introspection');
      agent._tracker.setActivity('Deep sentient introspection');
      return { success: true, introspection: agent.cognitive.introspect() };
    }
    case 'sentient_adaptive_process': {
      emitStatus('Adaptive coherence processing');
      agent._tracker.setActivity('Running adaptive coherence processing');
      const result = agent.cognitive.processTextAdaptive(args.text || '', {
        maxSteps: args.maxSteps,
        coherenceThreshold: args.coherenceThreshold,
      });
      return { success: true, ...result };
    }
    case 'sentient_set_goal': {
      const desc = args.description || '';
      emitStatus(`Setting sentient goal: ${desc.substring(0, 40)}`);
      agent._tracker.setActivity(`Setting goal: ${desc.substring(0, 40)}`);
      agent.cognitive.createGoal(desc, args.priority);
      return { success: true, message: `Goal created: ${desc}` };
    }
    case 'sentient_memory_search': {
      const query = args.query || '';
      emitStatus(`SMF memory search: "${query.substring(0, 40)}"`);
      agent._tracker.setActivity(`SMF memory search: "${query.substring(0, 40)}"`);
      const memories = agent.cognitive.recall(query, args.limit || 5);
      return {
        success: true,
        memories: memories.map(m => ({
          input: m.input,
          output: m.output,
          similarity: m.similarity,
          coherence: m.coherence,
          age: m.timestamp ? Date.now() - m.timestamp : undefined,
        })),
      };
    }
    case 'sentient_evolution_snapshot': {
      emitStatus('Capturing evolution snapshot');
      agent._tracker.setActivity('Capturing evolution snapshot');
      const stats = agent.cognitive.getAdaptiveStats?.() || {};
      const diagnostics = agent.cognitive.getDiagnostics();
      return {
        success: true,
        evolution: {
          adaptiveStats: stats,
          diagnostics,
          sentientEnabled: true,
        },
      };
    }
    default:
      return null;
  }
}
