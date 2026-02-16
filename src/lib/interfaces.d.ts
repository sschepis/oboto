/**
 * Interface for the AI Man Library Configuration
 */
export interface AiManConfig {
  /** The working directory for the project */
  workingDir: string;
  /** Adapter for the host LLM service */
  llmAdapter?: LLMAdapter;
  /** Adapter for status reporting */
  statusAdapter?: StatusAdapter;
  /** Optional overrides for internal components */
  overrides?: {
    model?: string;
    temperature?: number;
  };
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
 * The main interface for the library
 */
export interface AiManInterface {
  /**
   * Initialize the library
   */
  initialize(): Promise<void>;

  /**
   * Execute a high-level task
   * @param taskDescription The user's request
   * @returns The final result or confirmation
   */
  executeTask(taskDescription: string): Promise<string>;

  /**
   * Get the current status of the project/workspace
   */
  getProjectStatus(): Promise<any>;

  /**
   * Get the tool definition for integrating this library into an agent
   * @returns JSON Schema for the tool
   */
  getToolDefinition(): object;
}
