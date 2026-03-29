import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Use dynamic import for ESM compatibility
const { ConversationAgent } = await import('../conversation-agent.mjs');
const { ConversationContext } = await import('../../conversation-context.mjs');
const { MemoryBridge } = await import('../memory-bridge.mjs');
const { AssociativeStringStore } = await import('../memory.mjs');

function createMockHistoryManager() {
  return {
    maxTokens: 4096,
    contextWindowSize: 128000,
    history: [],
    systemMessage: null,
    getHistory: jest.fn(() => []),
    setHistory: jest.fn(),
    addMessage: jest.fn(),
    reset: jest.fn(),
    getTotalTokens: jest.fn(() => 0),
  };
}

function createTestAgent(overrides = {}) {
  const hm = createMockHistoryManager();
  const ctx = new ConversationContext('test-conv', hm);
  const memBridge = MemoryBridge.forAgent(
    null,
    new AssociativeStringStore(),
    new AssociativeStringStore()
  );

  return new ConversationAgent({
    id: 'agent-test-123',
    name: 'Test Agent',
    conversationContext: ctx,
    memoryBridge: memBridge,
    parentConversation: 'test-conv',
    agentConfig: {},
    deps: { eventBus: null },
    ...overrides,
  });
}

describe('ConversationAgent', () => {
  it('initializes with correct defaults', () => {
    const agent = createTestAgent();

    expect(agent.id).toBe('agent-test-123');
    expect(agent.name).toBe('Test Agent');
    expect(agent.status).toBe('created');
    expect(agent.parentConversation).toBe('test-conv');
    expect(agent.messageCount).toBe(0);
    expect(agent.createdAt).toBeDefined();
    expect(agent.lastActivity).toBeNull();
  });

  it('getStatus() returns correct status object', () => {
    const agent = createTestAgent();
    const status = agent.getStatus();

    expect(status.id).toBe('agent-test-123');
    expect(status.name).toBe('Test Agent');
    expect(status.status).toBe('created');
    expect(status.parentConversation).toBe('test-conv');
    expect(status.messageCount).toBe(0);
  });

  it('getHistory() returns the conversation history', () => {
    const agent = createTestAgent();
    const history = agent.getHistory();

    expect(Array.isArray(history)).toBe(true);
  });

  it('pause() changes status from running to paused', () => {
    const agent = createTestAgent();
    agent.status = 'running';
    agent._abortController = new AbortController();

    agent.pause();

    expect(agent.status).toBe('paused');
    expect(agent.lastActivity).toBeDefined();
  });

  it('pause() is a no-op if not running', () => {
    const agent = createTestAgent();
    agent.status = 'idle';

    agent.pause();

    expect(agent.status).toBe('idle');
  });

  it('resume() changes status from paused to idle', () => {
    const agent = createTestAgent();
    agent.status = 'paused';

    agent.resume();

    expect(agent.status).toBe('idle');
    expect(agent._abortController).toBeNull();
  });

  it('resume() is a no-op if not paused', () => {
    const agent = createTestAgent();
    agent.status = 'running';

    agent.resume();

    expect(agent.status).toBe('running');
  });

  it('terminate() sets status and cleans up', () => {
    const agent = createTestAgent();
    agent.status = 'running';
    agent._abortController = new AbortController();

    agent.terminate();

    expect(agent.status).toBe('terminated');
    expect(agent._abortController).toBeNull();
    expect(agent._provider).toBeNull();
    expect(agent.lastActivity).toBeDefined();
  });

  it('onReport() registers and unregisters callbacks', () => {
    const agent = createTestAgent();
    const callback = jest.fn();

    const unsub = agent.onReport(callback);

    expect(agent._reportCallbacks).toContain(callback);

    unsub();

    expect(agent._reportCallbacks).not.toContain(callback);
  });

  it('serialize() produces a valid serialization', () => {
    const agent = createTestAgent();
    agent.messageCount = 5;

    const data = agent.serialize();

    expect(data.id).toBe('agent-test-123');
    expect(data.name).toBe('Test Agent');
    expect(data.status).toBe('created');
    expect(data.parentConversation).toBe('test-conv');
    expect(data.messageCount).toBe(5);
    expect(data.history).toBeDefined();
    expect(data.aiProviderHistory).toBeDefined();
    expect(data.experiences).toBeDefined();
  });

  it('serialize() converts running status to idle', () => {
    const agent = createTestAgent();
    agent.status = 'running';

    const data = agent.serialize();

    expect(data.status).toBe('idle');
  });

  it('sendMessage() throws if terminated', async () => {
    const agent = createTestAgent();
    agent.status = 'terminated';

    await expect(agent.sendMessage('hello')).rejects.toThrow('terminated');
  });

  it('sendMessage() throws if paused', async () => {
    const agent = createTestAgent();
    agent.status = 'paused';

    await expect(agent.sendMessage('hello')).rejects.toThrow('paused');
  });

  it('start() throws if terminated', async () => {
    const agent = createTestAgent();
    agent.status = 'terminated';

    await expect(agent.start('do something')).rejects.toThrow('terminated');
  });
});
