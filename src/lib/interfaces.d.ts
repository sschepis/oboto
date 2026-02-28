/**
 * Interface for the AI Man Library Configuration
 */
export interface AiManConfig {
  /** The working directory for the project */
  workingDir?: string;
  /** Adapter for the host LLM service */
  llmAdapter?: LLMAdapter;
  /** Adapter for status reporting */
  statusAdapter?: StatusAdapter;
  /** Adapter for long-term memory (RAG) */
  memoryAdapter?: MemoryAdapter;
  /** Maximum conversation turns per execution (defaults to AI_MAX_TURNS env or 30) */
  maxTurns?: number;
  /** Optional overrides for internal components */
  overrides?: {
    model?: string;
    temperature?: number;
  };
}

/**
 * Options for execute(), executeStream(), design(), implement(), and designAndImplement() calls
 */
export interface ExecuteOptions {
  /** AbortSignal to cancel the execution */
  signal?: AbortSignal;
  /** Request structured output from the LLM */
  responseFormat?: {
    type: 'json_object' | 'json_schema';
    /** JSON Schema the output must conform to (for type: json_schema) */
    schema?: Record<string, any>;
  };
  /** Run in preview mode without side effects */
  dryRun?: boolean;
}

/**
 * Options for designAndImplement() calls
 */
export interface DesignAndImplementOptions extends ExecuteOptions {
  /** Callback invoked with the DesignResult before implementation begins */
  onDesignComplete?: (design: DesignResult) => void;
}

/**
 * Adapter interface for providing LLM capabilities
 * Conforms to OpenAI-compatible request/response structure
 */
export interface LLMAdapter {
  /**
   * call the LLM provider
   * @param requestBody The standard OpenAI chat completion request body
   * @returns The standard OpenAI chat completion response
   */
  generateContent(requestBody: any): Promise<any>;

  /**
   * (Optional) Stream the LLM response
   * @param requestBody The standard OpenAI chat completion request body
   * @returns A stream or async iterable of content chunks
   */
  generateContentStream?(requestBody: any): AsyncIterable<string> | Promise<ReadableStream>;
}

/**
 * Adapter interface for status reporting and logging
 */
export interface StatusAdapter {
  /**
   * Log a message from the system
   * @param level The log level or category (e.g., 'info', 'error', 'step', 'thought')
   * @param message The message content
   * @param metadata Optional metadata
   */
  log(level: string, message: string, metadata?: any): void;

  /**
   * Report progress on a long-running operation
   * @param progress 0-100 completion percentage
   * @param status Current status description
   */
  onProgress(progress: number, status: string): void;

  /**
   * Called when a tool execution starts
   * @param toolName Name of the tool
   * @param args Tool arguments
   */
  onToolStart(toolName: string, args: any): void;

  /**
   * Called when a tool execution completes
   * @param toolName Name of the tool
   * @param result Tool result
   */
  onToolEnd(toolName: string, result: any): void;
}

/**
 * Abstract base class for memory adapters
 */
export declare class MemoryAdapter {
  /** Store a text chunk with metadata */
  store(text: string, metadata?: Record<string, any>): Promise<void>;
  /** Retrieve top-K relevant chunks for a query */
  retrieve(query: string, topK?: number): Promise<Array<{
    text: string;
    score: number;
    metadata?: Record<string, any>;
  }>>;
}

/**
 * Error thrown when agent execution is cancelled via AbortSignal
 */
export declare class CancellationError extends Error {
  constructor(message?: string);
  name: 'CancellationError';
}

/**
 * Result returned by AiMan.design().
 * Contains the structured design document and metadata needed by implement().
 */
export declare class DesignResult {
  /** The original task description */
  task: string;
  /** The full design document produced by the agent */
  document: string;
  /** The working directory used during design */
  workingDir: string;
  /** ISO 8601 timestamp of when the design was created */
  createdAt: string;

  constructor(params: { task: string; document: string; workingDir: string });
}

/**
 * Return type of designAndImplement()
 */
export interface DesignAndImplementResult {
  /** The design that was produced */
  design: DesignResult;
  /** The implementation summary */
  result: string;
}

/**
 * Result of a dry-run execution
 */
export interface DryRunResult {
  /** What the agent planned to do */
  summary: string;
  /** All planned file changes */
  plannedChanges: Array<{
    type: 'write' | 'delete' | 'modify';
    path: string;
    content?: string;
    contentLength?: number;
    preview?: string;
  }>;
}

/**
 * Tool schema for registration
 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * Middleware interface
 */
export interface Middleware {
  /** Transform messages before sending to LLM */
  'pre-request'?(data: { messages: any[]; tools: any[] }): Promise<{ messages: any[]; tools: any[] }> | void;
  /** Transform/validate LLM response */
  'post-response'?(data: { message: any }): Promise<{ message: any }> | void;
  /** Gate or modify tool calls before execution */
  'pre-tool'?(data: { toolName: string; args: any }): Promise<{ toolName: string; args: any } | null> | void;
  /** Transform tool results */
  'post-tool'?(data: { toolName: string; result: string }): Promise<{ toolName: string; result: string }> | void;
}

/**
 * Lifecycle events
 */
export interface AiManEvents {
  'turn:start': { turnNumber: number; maxTurns: number; timestamp: number };
  'turn:end':   { turnNumber: number; timestamp: number };
  'tool:start': { toolName: string; args: any; timestamp: number };
  'tool:end':   { toolName: string; result: any; durationMs?: number; timestamp: number };
  'llm:request': { model: string; messageCount: number; estimatedTokens?: number; timestamp: number };
  'llm:response': { model: string; usage?: any; durationMs?: number; timestamp: number };
  'error':      { error: Error; phase?: string; timestamp: number };
}

/**
 * The main interface for the library
 */
export declare class AiMan {
  constructor(config?: AiManConfig);

  /**
   * Initialize the library
   */
  initialize(): Promise<void>;

  /**
   * Register a custom tool
   * @param schema OpenAI tool schema
   * @param handler Async function to execute the tool
   * @param outputSchema Optional JSON schema for result validation
   */
  registerTool(schema: ToolSchema, handler: (args: any) => Promise<string>, outputSchema?: Record<string, any>): this;

  /**
   * Add middleware to the execution chain
   */
  use(middleware: Middleware): this;

  /**
   * Subscribe to lifecycle events
   */
  on<K extends keyof AiManEvents>(event: K, listener: (payload: AiManEvents[K]) => void): this;
  
  /**
   * Unsubscribe from lifecycle events
   */
  off<K extends keyof AiManEvents>(event: K, listener: (payload: AiManEvents[K]) => void): this;

  /**
   * Create a named checkpoint of the conversation state
   */
  checkpoint(name: string): this;

  /**
   * Rollback conversation to a named checkpoint
   * @returns Timestamp of the checkpoint
   */
  rollbackTo(name: string): number;

  /**
   * List all checkpoints
   */
  listCheckpoints(): Array<{ name: string; timestamp: number; messageCount: number }>;

  /**
   * Send a conversational message to the assistant.
   * @param message The message to send
   * @param options Execution options including optional AbortSignal
   * @returns The assistant's response
   * @throws {CancellationError} If cancelled via signal
   */
  chat(message: string, options?: ExecuteOptions): Promise<string>;

  /**
   * Fork the current conversation state into a new independent instance
   */
  fork(): AiMan;

  /**
   * Execute a high-level task
   * @param task The user's request
   * @param options Execution options including optional AbortSignal and dryRun
   * @returns The final result or confirmation
   * @throws {CancellationError} If cancelled via signal
   */
  execute(task: string, options?: ExecuteOptions): Promise<string>;

  /**
   * Execute a high-level task with streaming output
   * @param task The user's request
   * @param onChunk Callback for each chunk of streamed content
   * @param options Execution options including optional AbortSignal
   * @returns The final result
   * @throws {CancellationError} If cancelled via signal
   */
  executeStream(task: string, onChunk: (chunk: string) => void, options?: ExecuteOptions): Promise<string>;

  /**
   * Design phase: Run the agent to produce a structured technical design document.
   *
   * @param task High-level description of what to build
   * @param options Execution options including optional AbortSignal
   * @returns The design result containing the design document
   * @throws {CancellationError} If cancelled via signal
   */
  design(task: string, options?: ExecuteOptions): Promise<DesignResult>;

  /**
   * Implementation phase: Take a design result and implement all features.
   *
   * @param designResult The result from a prior design() call
   * @param options Execution options including optional AbortSignal
   * @returns Summary of what was implemented
   * @throws {CancellationError} If cancelled via signal
   */
  implement(designResult: DesignResult, options?: ExecuteOptions): Promise<string>;

  /**
   * Convenience method: Design and implement in one call.
   *
   * @param task High-level description of what to build
   * @param options Execution options including optional AbortSignal and onDesignComplete callback
   * @returns Both the design and implementation result
   * @throws {CancellationError} If cancelled via signal
   */
  designAndImplement(task: string, options?: DesignAndImplementOptions): Promise<DesignAndImplementResult>;

  /**
   * Generate and run tests for an implementation.
   * @param implementationResult Result from implement()
   * @param options Execution options
   */
  test(implementationResult: string | { result: string }, options?: ExecuteOptions): Promise<string>;

  /**
   * Review implementation against design.
   * @param designResult The design document
   * @param implementationResult The implementation summary
   * @param options Execution options
   */
  review(designResult: DesignResult, implementationResult: string | { result: string }, options?: ExecuteOptions): Promise<{ overallScore: number | null; findings: any[]; summary: string }>;

  /**
   * Get the current status of the project/workspace
   */
  getContext(): any;

  /**
   * Get the tool definition for integrating this library into an agent
   * @returns JSON Schema for the tool
   */
  getToolDefinition(): object;

  // Async Task Public API

  /**
   * Spawns a background task.
   * @param query The prompt/instructions for the task
   * @param description Human-readable description
   * @param options Additional options (context, etc.)
   */
  spawnTask(query: string, description: string, options?: any): any;

  /**
   * Get a task by ID.
   * @param taskId 
   */
  getTaskStatus(taskId: string): any;

  /**
   * List all tasks, optionally filtered by status.
   * @param filter 'all', 'running', 'completed', 'failed'
   */
  listTasks(filter?: string): any[];

  /**
   * Wait for a specific task to complete.
   * @param taskId 
   * @param timeout Timeout in seconds
   */
  waitForTask(taskId: string, timeout?: number): Promise<any>;
}

export { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
export { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
export { MemoryAdapter } from './adapters/memory-adapter.mjs';
export { EventicFacade as MiniAIAssistant, EventicFacade as AssistantFacade } from '../core/eventic-facade.mjs';
export { config } from '../config.mjs';
export { consoleStyler } from '../ui/console-styler.mjs';
export { AiManEventBus } from './event-bus.mjs';
export { MiddlewareChain } from './middleware.mjs';
export { FlowManager } from '../structured-dev/flow-manager.mjs';
export { ManifestManager } from '../structured-dev/manifest-manager.mjs';
export { C4Visualizer } from '../structured-dev/c4-visualizer.mjs';
export { KnowledgeGraphBuilder } from '../structured-dev/knowledge-graph-builder.mjs';
export { CiCdArchitect } from '../structured-dev/cicd-architect.mjs';
export { ContainerizationWizard } from '../structured-dev/containerization-wizard.mjs';
export { ApiDocSmith } from '../structured-dev/api-doc-smith.mjs';
export { TutorialGenerator } from '../structured-dev/tutorial-generator.mjs';
export { EnhancementGenerator } from '../structured-dev/enhancement-generator.mjs';
export { CancellationError } from './cancellation-error.mjs';
export { DesignResult } from './design-result.mjs';
export { TaskManager } from '../core/task-manager.mjs';
export { TaskCheckpointManager } from '../core/task-checkpoint-manager.mjs';
export { CheckpointStore } from '../core/checkpoint-store.mjs';

/**
 * Alias for AiMan, emphasizing the robotic developer persona.
 */
export declare const Oboto: typeof AiMan;


