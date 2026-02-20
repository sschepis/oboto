import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Status Adapter that outputs to the console using consoleStyler
 * This is the default behavior if no adapter is provided
 */
export class ConsoleStatusAdapter {
  constructor() {}

  /**
   * Log a message
   * @param {string} level - Log level/category
   * @param {string} message - Message content
   * @param {Object} [metadata] - Optional metadata
   */
  log(level, message, metadata = {}) {
    consoleStyler.log(level, message, metadata);
  }

  /**
   * Report progress
   * @param {number} progress - 0-100
   * @param {string} status - Status description
   */
  onProgress(progress, status) {
    consoleStyler.log('progress', `[${progress}%] ${status}`);
  }

  /**
   * Called when a tool starts
   * @param {string} toolName 
   * @param {Object} args 
   */
  onToolStart(toolName, args) {
    // consoleStyler handles tool logging internally via logs typically, 
    // but we can make it explicit here
    // consoleStyler.log('working', `Executing tool: ${toolName}`);
  }

  /**
   * Called when a tool ends
   * @param {string} toolName 
   * @param {any} result 
   */
  onToolEnd(toolName, result) {
    // consoleStyler.log('tools', `✓ Tool completed: ${toolName}`);
  }

  /**
   * Called when the pipeline finishes processing a request
   * @param {string} response - The final response text
   */
  onComplete(response) {
    // Default: no-op. Subclasses can override to emit events etc.
  }
}
