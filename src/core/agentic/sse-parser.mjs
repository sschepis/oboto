/**
 * SSE Parser — parses streaming LLM API responses.
 *
 * Handles both OpenAI-compatible and Anthropic-native SSE formats,
 * accumulating text content and tool call deltas into a complete
 * response that mirrors the non-streaming format.
 *
 * OpenAI SSE format:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 *
 * Anthropic SSE format:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
 *   event: message_stop
 *   data: {"type":"message_stop"}
 *
 * @module src/core/agentic/sse-parser
 */

/**
 * Reusable SSE (Server-Sent Events) parser for streaming LLM responses.
 */
export class SSEParser {
  /**
   * @param {Object} options
   * @param {Function} [options.onToken]    - Called with each text token (string)
   * @param {Function} [options.onToolCall] - Called with tool call deltas
   * @param {Function} [options.onUsage]    - Called with usage data when available
   * @param {Function} [options.onDone]     - Called when the stream completes
   * @param {Function} [options.onError]    - Called on parse errors
   */
  constructor(options = {}) {
    /** @private */ this._onToken = typeof options.onToken === 'function' ? options.onToken : null;
    /** @private */ this._onToolCall = typeof options.onToolCall === 'function' ? options.onToolCall : null;
    /** @private */ this._onUsage = typeof options.onUsage === 'function' ? options.onUsage : null;
    /** @private */ this._onDone = typeof options.onDone === 'function' ? options.onDone : null;
    /** @private */ this._onError = typeof options.onError === 'function' ? options.onError : null;

    // Accumulated state
    /** @private */ this._content = '';
    /** @private */ this._toolCalls = [];
    /** @private */ this._usage = null;
    /** @private */ this._finishReason = null;
    /** @private */ this._done = false;

    // SSE line buffer for partial chunks
    /** @private */ this._buffer = '';

    // Anthropic-specific: track active tool_use blocks by content_block index
    /** @private */ this._anthropicToolBlocks = new Map();
    /** @private */ this._anthropicToolCallIndex = 0;

    // Current SSE event type (set by "event:" lines in Anthropic streams)
    /** @private */ this._currentEventType = null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Feed a chunk of raw SSE text data to the parser.
   * Handles partial lines that may span multiple chunks.
   *
   * @param {string} chunk - Raw SSE text chunk from the response stream
   */
  feed(chunk) {
    if (this._done) return;

    this._buffer += chunk;
    const lines = this._buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      this._processLine(line);
    }
  }

  /**
   * Signal that no more data will arrive. Processes any remaining
   * buffered data and fires the onDone callback.
   */
  finish() {
    // Process any remaining buffer content
    if (this._buffer.trim()) {
      this._processLine(this._buffer);
      this._buffer = '';
    }
    this._signalDone();
  }

  /**
   * Get the accumulated text content.
   * @returns {string}
   */
  get content() {
    return this._content;
  }

  /**
   * Get the accumulated tool calls (empty array if none).
   * @returns {Array<{id: string, function: {name: string, arguments: string}}>}
   */
  get toolCalls() {
    return this._toolCalls.filter(Boolean);
  }

  /**
   * Get accumulated usage stats, or null if not yet available.
   * Returns OpenAI-compatible format:
   *   { prompt_tokens, completion_tokens, total_tokens }
   *
   * @returns {Object|null}
   */
  get usage() {
    return this._usage;
  }

  /**
   * Get the finish reason (e.g. 'stop', 'tool_calls', 'length').
   * @returns {string|null}
   */
  get finishReason() {
    return this._finishReason;
  }

  /**
   * Whether the stream has completed.
   * @returns {boolean}
   */
  get isDone() {
    return this._done;
  }

  /**
   * Reset the parser to its initial state so it can be reused.
   */
  reset() {
    this._content = '';
    this._toolCalls = [];
    this._usage = null;
    this._finishReason = null;
    this._done = false;
    this._buffer = '';
    this._anthropicToolBlocks.clear();
    this._anthropicToolCallIndex = 0;
    this._currentEventType = null;
  }

  /**
   * Build a complete response object matching the non-streaming format.
   * Use after the stream completes.
   *
   * @returns {{ content: string, toolCalls: Array|null, rawMessage: Object, usage: Object|null }}
   */
  toResponse() {
    const toolCalls = this.toolCalls;
    const message = {
      role: 'assistant',
      content: this._content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return {
      content: this._content,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      rawMessage: message,
      usage: this._usage,
      finishReason: this._finishReason,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Private — line processing
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Process a single SSE line.
   * @private
   * @param {string} line
   */
  _processLine(line) {
    const trimmed = line.trim();

    // Empty line = event boundary in SSE spec; reset event type
    if (!trimmed) {
      this._currentEventType = null;
      return;
    }

    // SSE comment lines (start with ':')
    if (trimmed.startsWith(':')) return;

    // "event:" lines — Anthropic uses these
    if (trimmed.startsWith('event:')) {
      this._currentEventType = trimmed.slice(6).trim();

      // Anthropic: "event: message_stop" may not have a data line
      if (this._currentEventType === 'message_stop') {
        this._signalDone();
      }
      return;
    }

    // "data:" lines — the main payload
    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trim();

      // OpenAI end sentinel
      if (data === '[DONE]') {
        this._signalDone();
        return;
      }

      if (!data) return;
      this._parseEvent(data);
    }
  }

  /**
   * Parse a complete SSE data payload (after "data:" prefix is removed).
   * Auto-detects OpenAI vs Anthropic format based on the JSON structure.
   *
   * @private
   * @param {string} data - JSON string from SSE data line
   */
  _parseEvent(data) {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      if (this._onError) {
        this._onError(new Error(`SSE JSON parse error: ${err.message}`));
      }
      return;
    }

    // Detect format by presence of distinguishing fields

    // OpenAI format: has "choices" array
    if (parsed.choices) {
      this._parseOpenAIDelta(parsed);
      return;
    }

    // Anthropic format: has "type" field
    if (parsed.type) {
      this._parseAnthropicDelta(parsed);
      return;
    }

    // Error payloads
    if (parsed.error) {
      if (this._onError) {
        const msg = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || JSON.stringify(parsed.error);
        this._onError(new Error(`SSE error event: ${msg}`));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Private — OpenAI format
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Parse an OpenAI-format streaming delta.
   * Structure: { choices: [{ delta: { content, tool_calls }, finish_reason }], usage? }
   *
   * @private
   * @param {Object} parsed - Parsed JSON from SSE data line
   */
  _parseOpenAIDelta(parsed) {
    const choice = parsed.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;

    // Text content delta
    if (delta?.content) {
      this._content += delta.content;
      if (this._onToken) {
        this._onToken(delta.content);
      }
    }

    // Tool call deltas
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.index == null) continue;

        if (tc.id) {
          // First chunk for this tool call — initialize
          this._toolCalls[tc.index] = {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            },
          };
          if (this._onToolCall) {
            this._onToolCall({ type: 'start', index: tc.index, id: tc.id, name: tc.function?.name });
          }
        } else if (this._toolCalls[tc.index]) {
          // Continuation chunk — accumulate
          if (tc.function?.name) {
            this._toolCalls[tc.index].function.name = tc.function.name;
          }
          this._toolCalls[tc.index].function.arguments += (tc.function?.arguments || '');
          if (this._onToolCall) {
            this._onToolCall({ type: 'delta', index: tc.index, arguments: tc.function?.arguments });
          }
        }
      }
    }

    // Finish reason
    if (choice.finish_reason) {
      this._finishReason = choice.finish_reason;
    }

    // Usage data (OpenAI includes this when stream_options: { include_usage: true })
    if (parsed.usage) {
      this._usage = {
        prompt_tokens: parsed.usage.prompt_tokens || 0,
        completion_tokens: parsed.usage.completion_tokens || 0,
        total_tokens: parsed.usage.total_tokens || 0,
      };
      if (this._onUsage) {
        this._onUsage(this._usage);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Private — Anthropic format
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Parse an Anthropic-format streaming event.
   * Anthropic uses typed events:
   *   - message_start:        Initial message metadata
   *   - content_block_start:  Start of a content block (text or tool_use)
   *   - content_block_delta:  Incremental delta within a block
   *   - content_block_stop:   End of a content block
   *   - message_delta:        Message-level changes (stop_reason, usage)
   *   - message_stop:         End of the message
   *
   * @private
   * @param {Object} parsed - Parsed JSON from SSE data line
   */
  _parseAnthropicDelta(parsed) {
    switch (parsed.type) {
      case 'message_start':
        // Contains initial usage in parsed.message.usage
        if (parsed.message?.usage) {
          this._usage = {
            prompt_tokens: parsed.message.usage.input_tokens || 0,
            completion_tokens: parsed.message.usage.output_tokens || 0,
            total_tokens: (parsed.message.usage.input_tokens || 0) +
                          (parsed.message.usage.output_tokens || 0),
          };
        }
        break;

      case 'content_block_start':
        if (parsed.content_block?.type === 'tool_use') {
          // New tool call block
          const block = parsed.content_block;
          const tcIdx = this._anthropicToolCallIndex++;
          this._anthropicToolBlocks.set(parsed.index, {
            id: block.id,
            name: block.name,
            tcIdx,
          });
          this._toolCalls[tcIdx] = {
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: '',
            },
          };
          if (this._onToolCall) {
            this._onToolCall({ type: 'start', index: tcIdx, id: block.id, name: block.name });
          }
        }
        break;

      case 'content_block_delta':
        if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
          // Text content delta
          this._content += parsed.delta.text;
          if (this._onToken) {
            this._onToken(parsed.delta.text);
          }
        } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta?.partial_json != null) {
          // Tool call argument delta
          const tracked = this._anthropicToolBlocks.get(parsed.index);
          if (tracked && this._toolCalls[tracked.tcIdx]) {
            this._toolCalls[tracked.tcIdx].function.arguments += parsed.delta.partial_json;
            if (this._onToolCall) {
              this._onToolCall({ type: 'delta', index: tracked.tcIdx, arguments: parsed.delta.partial_json });
            }
          }
        }
        break;

      case 'content_block_stop':
        this._anthropicToolBlocks.delete(parsed.index);
        break;

      case 'message_delta':
        // Contains stop_reason and final usage
        if (parsed.delta?.stop_reason) {
          this._finishReason = this._mapAnthropicFinishReason(parsed.delta.stop_reason);
        }
        if (parsed.usage) {
          // Anthropic message_delta includes output_tokens in usage
          const prevPrompt = this._usage?.prompt_tokens || 0;
          const outputTokens = parsed.usage.output_tokens || 0;
          this._usage = {
            prompt_tokens: prevPrompt,
            completion_tokens: outputTokens,
            total_tokens: prevPrompt + outputTokens,
          };
          if (this._onUsage) {
            this._onUsage(this._usage);
          }
        }
        break;

      case 'message_stop':
        this._signalDone();
        break;

      case 'ping':
        // Anthropic keep-alive, ignore
        break;

      default:
        // Unknown event type — ignore silently
        break;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Private — helpers
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Map Anthropic stop_reason to OpenAI finish_reason.
   * @private
   * @param {string} stopReason
   * @returns {string}
   */
  _mapAnthropicFinishReason(stopReason) {
    switch (stopReason) {
      case 'end_turn': return 'stop';
      case 'max_tokens': return 'length';
      case 'stop_sequence': return 'stop';
      case 'tool_use': return 'tool_calls';
      default: return stopReason || 'stop';
    }
  }

  /**
   * Signal stream completion. Idempotent — only fires once.
   * @private
   */
  _signalDone() {
    if (this._done) return;
    this._done = true;
    if (this._onDone) {
      this._onDone(this.toResponse());
    }
  }
}
