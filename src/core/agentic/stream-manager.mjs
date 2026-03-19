/**
 * StreamManager — unified streaming lifecycle management for agentic providers.
 *
 * Extracts the duplicate streaming patterns from CognitiveAgent and
 * LMScriptProvider into a single reusable class.  Providers create one
 * StreamManager per turn/run and wire it to the user-supplied onToken/onChunk
 * callbacks.  Internal tool-loop calls suppress streaming via
 * {@link StreamManager#suppress suppress()} so tool-call JSON is never
 * leaked to users.
 *
 * Key features:
 * - suppress/resume toggle for tool-loop phases
 * - optional token buffering with configurable buffer size
 * - AbortSignal-aware: stops emitting when signal is aborted
 * - getCallbacks() returns { onToken, onChunk } for passing to LLM calls
 * - graceful no-op when no callbacks are registered
 *
 * @module src/core/agentic/stream-manager
 */

/**
 * Manages the lifecycle of streaming output for a single agentic turn.
 */
export class StreamManager {
  /**
   * @param {Object} options
   * @param {Function} [options.onToken]    - Called with each text token (string)
   * @param {Function} [options.onChunk]    - Called with each chunk object
   * @param {number}   [options.bufferSize=0] - Number of tokens to buffer before flushing (0 = immediate)
   * @param {AbortSignal} [options.signal]  - AbortSignal for cancellation
   */
  constructor(options = {}) {
    /** @private */
    this._onToken = typeof options.onToken === 'function' ? options.onToken : null;
    /** @private */
    this._onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
    /** @private */
    this._bufferSize = Math.max(0, options.bufferSize || 0);
    /** @private */
    this._signal = options.signal || null;
    /** @private */
    this._suppressed = false;
    /** @private */
    this._buffer = [];
    /** @private */
    this._disposed = false;
  }

  // ════════════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════════════

  /**
   * Emit a text token.  Respects suppression state and abort signal.
   * When buffering is enabled, tokens accumulate until the buffer is
   * full or {@link StreamManager#flush flush()} is called.
   *
   * @param {string} text - The token text to emit
   */
  token(text) {
    if (this._disposed || this._suppressed || this._isAborted()) return;
    if (!this._onToken) return;

    if (this._bufferSize > 0) {
      this._buffer.push(text);
      if (this._buffer.length >= this._bufferSize) {
        this.flush();
      }
    } else {
      this._onToken(text);
    }
  }

  /**
   * Emit a chunk object.  Respects suppression state and abort signal.
   * Chunks are never buffered — they pass through immediately.
   *
   * @param {*} data - The chunk data to emit
   */
  chunk(data) {
    if (this._disposed || this._suppressed || this._isAborted()) return;
    if (!this._onChunk) return;
    this._onChunk(data);
  }

  /**
   * Suppress all output.  Use before tool execution or internal LLM
   * calls whose output should not be streamed to the user.
   */
  suppress() {
    this._suppressed = true;
  }

  /**
   * Resume output after suppression.
   */
  resume() {
    this._suppressed = false;
  }

  /**
   * Whether streaming is currently suppressed.
   * @returns {boolean}
   */
  get isSuppressed() {
    return this._suppressed;
  }

  /**
   * Whether any callbacks are registered (convenience check).
   * Returns false after dispose().
   * @returns {boolean}
   */
  get isActive() {
    return !this._disposed && (this._onToken !== null || this._onChunk !== null);
  }

  /**
   * Flush any buffered tokens to the onToken callback.
   * Concatenates all buffered tokens into a single string and delivers
   * them as one call.
   */
  flush() {
    if (this._disposed || this._isAborted()) return;
    if (this._buffer.length === 0) return;
    if (!this._onToken) {
      this._buffer.length = 0;
      return;
    }

    const combined = this._buffer.join('');
    this._buffer.length = 0;
    this._onToken(combined);
  }

  /**
   * Clean up resources.  Flushes any remaining buffer and nulls out
   * callbacks so no further emissions occur.
   */
  dispose() {
    if (this._disposed) return;
    this.flush();
    this._onToken = null;
    this._onChunk = null;
    this._buffer.length = 0;
    this._signal = null;
    this._disposed = true;
  }

  /**
   * Get streaming callbacks suitable for passing to LLM call options.
   * The returned callbacks route through this manager, respecting
   * suppression and abort state.
   *
   * @returns {{ onToken: Function|undefined, onChunk: Function|undefined }}
   */
  getCallbacks() {
    const result = {};
    if (this._onToken) {
      result.onToken = (t) => this.token(t);
    }
    if (this._onChunk) {
      result.onChunk = (c) => this.chunk(c);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════
  // Private helpers
  // ════════════════════════════════════════════════════════════════════

  /**
   * Check if the abort signal has been triggered.
   * @private
   * @returns {boolean}
   */
  _isAborted() {
    return this._signal?.aborted === true;
  }
}
