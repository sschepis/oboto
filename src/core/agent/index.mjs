/**
 * Agent module barrel export
 *
 * Re-exported from newagent/src/agent into src/core/agent.
 * Provides a self-contained autonomous agent loop with VFS, dual memory,
 * AST pipeline, and CLI executor — all orchestrated by AgentRunner.
 *
 * @module src/core/agent
 */

export { apiKey, MAX_CONTEXT_TURNS, DEFAULT_MODEL, INITIAL_VFS, DEFAULT_PERSONA, AgentResponseSchema, buildSystemPrompt, buildAgentFunction } from './config.mjs';
export { loadDependencies, getAstModules, getTransformersPipeline } from './loader.mjs';
export { cosineSimilarity, AssociativeStringStore } from './memory.mjs';
export { MemoryBridge } from './memory-bridge.mjs';
export { VirtualFileSystem, VFSSyncAdapter } from './vfs.mjs';
export { PipelineExecutionError, ASTManager, UtilityAdapter, PipelineEngine } from './pipeline.mjs';
export { executeCommand } from './executor.mjs';
export { getRuntime, executeFunction } from './api.mjs';
export { AgentRunner } from './AgentRunner.mjs';
export { ConversationAgent } from './conversation-agent.mjs';
export { ConversationAgentManager } from './conversation-agent-manager.mjs';
export { AGENT_SOURCE_DIR, AGENT_PROJECT_ROOT, getSourceManifest, selfRead, selfWrite, selfList, selfRestart, invalidateModuleCache, mountSourceInVFS } from './self-awareness.mjs';
