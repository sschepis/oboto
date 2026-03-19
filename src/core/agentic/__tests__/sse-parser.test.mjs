import { SSEParser } from '../sse-parser.mjs';

describe('SSEParser', () => {
  // ════════════════════════════════════════════════════════════════════════
  // OpenAI format
  // ════════════════════════════════════════════════════════════════════════

  describe('OpenAI format', () => {
    it('should parse text content deltas', () => {
      const tokens = [];
      const parser = new SSEParser({
        onToken: (t) => tokens.push(t),
      });

      parser.feed('data: {"choices":[{"delta":{"content":"Hello"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":" world"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(tokens).toEqual(['Hello', ' world']);
      expect(parser.content).toBe('Hello world');
      expect(parser.isDone).toBe(true);
    });

    it('should handle partial chunks across multiple feed() calls', () => {
      const tokens = [];
      const parser = new SSEParser({
        onToken: (t) => tokens.push(t),
      });

      // Split a single SSE event across two chunks
      parser.feed('data: {"choices":[{"delta":');
      parser.feed('{"content":"Hello"}}]}\n\ndata: [DONE]\n\n');

      expect(tokens).toEqual(['Hello']);
      expect(parser.content).toBe('Hello');
      expect(parser.isDone).toBe(true);
    });

    it('should accumulate tool call deltas', () => {
      const toolEvents = [];
      const parser = new SSEParser({
        onToolCall: (e) => toolEvents.push(e),
      });

      // First chunk: tool call start
      parser.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"get_weather","arguments":""}}]},"index":0,"finish_reason":null}]}\n\n');
      // Second chunk: arguments delta
      parser.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]},"index":0,"finish_reason":null}]}\n\n');
      // Third chunk: more arguments
      parser.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"NYC\\"}"}}]},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(parser.toolCalls).toHaveLength(1);
      expect(parser.toolCalls[0].id).toBe('call_123');
      expect(parser.toolCalls[0].function.name).toBe('get_weather');
      expect(parser.toolCalls[0].function.arguments).toBe('{"city":"NYC"}');

      expect(toolEvents).toEqual([
        { type: 'start', index: 0, id: 'call_123', name: 'get_weather' },
        { type: 'delta', index: 0, arguments: '{"city":' },
        { type: 'delta', index: 0, arguments: '"NYC"}' },
      ]);
    });

    it('should capture usage from final chunk', () => {
      let capturedUsage = null;
      const parser = new SSEParser({
        onUsage: (u) => { capturedUsage = u; },
      });

      parser.feed('data: {"choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(parser.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
      expect(capturedUsage).toEqual(parser.usage);
      expect(parser.finishReason).toBe('stop');
    });

    it('should handle [DONE] sentinel', () => {
      let doneCalled = false;
      const parser = new SSEParser({
        onDone: () => { doneCalled = true; },
      });

      parser.feed('data: {"choices":[{"delta":{"content":"test"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(doneCalled).toBe(true);
      expect(parser.isDone).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Anthropic format
  // ════════════════════════════════════════════════════════════════════════

  describe('Anthropic format', () => {
    it('should parse text content deltas', () => {
      const tokens = [];
      const parser = new SSEParser({
        onToken: (t) => tokens.push(t),
      });

      parser.feed('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":0}}}\n\n');
      parser.feed('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
      parser.feed('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n');
      parser.feed('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n');
      parser.feed('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
      parser.feed('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n');
      parser.feed('event: message_stop\ndata: {"type":"message_stop"}\n\n');

      expect(tokens).toEqual(['Hello', ' world']);
      expect(parser.content).toBe('Hello world');
      expect(parser.isDone).toBe(true);
      expect(parser.finishReason).toBe('stop');
    });

    it('should handle tool use blocks', () => {
      const toolEvents = [];
      const parser = new SSEParser({
        onToolCall: (e) => toolEvents.push(e),
      });

      parser.feed('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_123","name":"get_weather"}}\n\n');
      parser.feed('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}\n\n');
      parser.feed('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"NYC\\"}"}}\n\n');
      parser.feed('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n');
      parser.feed('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}\n\n');
      parser.feed('event: message_stop\ndata: {"type":"message_stop"}\n\n');

      expect(parser.toolCalls).toHaveLength(1);
      expect(parser.toolCalls[0].id).toBe('toolu_123');
      expect(parser.toolCalls[0].function.name).toBe('get_weather');
      expect(parser.toolCalls[0].function.arguments).toBe('{"city":"NYC"}');
      expect(parser.finishReason).toBe('tool_calls');
    });

    it('should capture usage from message_start and message_delta', () => {
      const parser = new SSEParser();

      parser.feed('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":0}}}\n\n');
      parser.feed('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n');
      parser.feed('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n');
      parser.feed('event: message_stop\ndata: {"type":"message_stop"}\n\n');

      expect(parser.usage).toEqual({
        prompt_tokens: 25,
        completion_tokens: 10,
        total_tokens: 35,
      });
    });

    it('should handle ping events without error', () => {
      const parser = new SSEParser();
      parser.feed('event: ping\ndata: {"type":"ping"}\n\n');
      expect(parser.isDone).toBe(false);
      expect(parser.content).toBe('');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // General behavior
  // ════════════════════════════════════════════════════════════════════════

  describe('general behavior', () => {
    it('should reset parser state', () => {
      const parser = new SSEParser();
      parser.feed('data: {"choices":[{"delta":{"content":"Hello"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: [DONE]\n\n');

      expect(parser.content).toBe('Hello');
      expect(parser.isDone).toBe(true);

      parser.reset();

      expect(parser.content).toBe('');
      expect(parser.isDone).toBe(false);
      expect(parser.toolCalls).toEqual([]);
      expect(parser.usage).toBeNull();
    });

    it('should build a complete response object via toResponse()', () => {
      const parser = new SSEParser();
      parser.feed('data: {"choices":[{"delta":{"content":"Hello"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n');
      parser.feed('data: [DONE]\n\n');

      const resp = parser.toResponse();
      expect(resp.content).toBe('Hello');
      expect(resp.toolCalls).toBeNull();
      expect(resp.rawMessage.role).toBe('assistant');
      expect(resp.rawMessage.content).toBe('Hello');
      expect(resp.usage).toEqual({
        prompt_tokens: 5,
        completion_tokens: 1,
        total_tokens: 6,
      });
      expect(resp.finishReason).toBe('stop');
    });

    it('should handle SSE comments (lines starting with ":")', () => {
      const parser = new SSEParser();
      parser.feed(': this is a comment\n');
      parser.feed('data: {"choices":[{"delta":{"content":"Hi"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: [DONE]\n\n');
      expect(parser.content).toBe('Hi');
    });

    it('should report JSON parse errors via onError', () => {
      const errors = [];
      const parser = new SSEParser({
        onError: (e) => errors.push(e.message),
      });
      parser.feed('data: {invalid json}\n\n');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('SSE JSON parse error');
    });

    it('should handle finish() for remaining buffer data', () => {
      const parser = new SSEParser();
      // Feed data without trailing newline
      parser.feed('data: {"choices":[{"delta":{"content":"end"},"index":0,"finish_reason":"stop"}]}');
      parser.finish();
      expect(parser.content).toBe('end');
      expect(parser.isDone).toBe(true);
    });

    it('should be idempotent on multiple finish/done signals', () => {
      let doneCount = 0;
      const parser = new SSEParser({
        onDone: () => { doneCount++; },
      });
      parser.feed('data: [DONE]\n\n');
      parser.finish();
      expect(doneCount).toBe(1); // Only called once
    });

    it('should ignore data after [DONE]', () => {
      const parser = new SSEParser();
      parser.feed('data: {"choices":[{"delta":{"content":"A"},"index":0,"finish_reason":null}]}\n\n');
      parser.feed('data: [DONE]\n\n');
      parser.feed('data: {"choices":[{"delta":{"content":"B"},"index":0,"finish_reason":null}]}\n\n');
      expect(parser.content).toBe('A');
    });
  });
});
