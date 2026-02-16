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
  /** Maximum conversation turns per execution (defaults to AI_MAX_TURNS env or 30) */
  maxTurns?: number;
  /** Optional overrides for internal components */
  overrides?: {
    model?: string;
    temperature?: number;
  };
}

/**
 * Options for execute() and executeStream() calls
 */
export interface ExecuteOptions {
  /** AbortSignal to cancel the execution */
  signal?: AbortSignal;
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
 * Error thrown when agent execution is cancelled via AbortSignal
 */
export declare class CancellationError extends Error {
  constructor(message?: string);
  name: 'CancellationError';
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
   * Execute a high-level task
   * @param task The user's request
   * @param options Execution options including optional AbortSignal
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
   * Get the current status of the project/workspace
   */
  getContext(): any;

  /**
   * Get the tool definition for integrating this library into an agent
   * @returns JSON Schema for the tool
   */
  getToolDefinition(): object;
}

export { ConsoleStatusAdapter } from './adapters/console-status-adapter.mjs';
export { NetworkLLMAdapter } from './adapters/network-llm-adapter.mjs';
export { MiniAIAssistant } from '../core/ai-assistant.mjs';
export { config } from '../config.mjs';
export { consoleStyler } from '../ui/console-styler.mjs';
