import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { ConversationAgentManager } = await import('../conversation-agent-manager.mjs');
const { ConversationContext } = await import('../../conversation-context.mjs');

function createMockHistoryManager() {
  return {
    maxTokens: 4096,
    contextWindowSize: 128000,
    history: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    systemMessage: 'You are a helpful assistant.',
    getHistory: jest.fn(function () { return this.history; }),
    setHistory: jest.fn(function (h) { this.history = h; }),
    addMessage: jest.fn(),
    reset: jest.fn(),
    getTotalTokens: jest.fn(() => 100),
  };
}

function createMockDeps() {
  return {
    aiProvider: { model: 'test-model' },
    toolExecutor: {},
    eventBus: {
      emit: jest.fn(),
      on: jest.fn(),
    },
    historyManager: createMockHistoryManager(),
    workingDir: os.tmpdir(),
    engine: {},
    config: {},
  };
}

describe('ConversationAgentManager', () => {
  let tmpDir;
  let manager;
  let deps;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = path.join(os.tmpdir(), `agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });

    deps = createMockDeps();
    manager = new ConversationAgentManager({
      workingDir: tmpDir,
      deps,
    });
    await manager.initialize();
  });

  it('initializes and creates the .agents/ directory', async () => {
    const agentsDir = path.join(tmpDir, '.agents');
    const stat = await fs.promises.stat(agentsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('listAgents() returns empty array initially', () => {
    const agents = manager.listAgents();
    expect(agents).toEqual([]);
  });

  it('createAgent() creates a new agent with fork mode', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('my-chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'my-chat',
      agentName: 'researcher',
      mode: 'fork',
    });

    expect(result.agentId).toMatch(/^agent-researcher-/);
    expect(result.agentName).toBe('researcher');
    expect(result.parentConversation).toBe('my-chat');

    // Agent should appear in list
    const agents = manager.listAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('researcher');
  });

  it('createAgent() with in-place mode marks the context as promoted', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('my-chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'my-chat',
      agentName: 'in-place-agent',
      mode: 'in-place',
    });

    expect(ctx.isPromoted).toBe(true);
    expect(ctx.promotedToAgentId).toBe(result.agentId);
  });

  it('getAgent() returns null for unknown ID', () => {
    expect(manager.getAgent('nonexistent')).toBeNull();
  });

  it('getAgent() returns agent for valid ID', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'chat',
      agentName: 'test',
    });

    const agent = manager.getAgent(result.agentId);
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('test');
  });

  it('terminateAgent() terminates the agent', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'chat',
    });

    const termResult = manager.terminateAgent(result.agentId);
    expect(termResult.agentId).toBe(result.agentId);

    const agent = manager.getAgent(result.agentId);
    expect(agent.status).toBe('terminated');
  });

  it('terminateAgent() throws for unknown agent', () => {
    expect(() => manager.terminateAgent('unknown')).toThrow('not found');
  });

  it('pauseAgent() pauses a running agent', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'chat',
    });

    const agent = manager.getAgent(result.agentId);
    agent.status = 'running';
    agent._abortController = new AbortController();

    const pauseResult = manager.pauseAgent(result.agentId);
    expect(pauseResult.status).toBe('paused');
  });

  it('resumeAgent() resumes a paused agent', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'chat',
    });

    const agent = manager.getAgent(result.agentId);
    agent.status = 'paused';

    const resumeResult = manager.resumeAgent(result.agentId);
    expect(resumeResult.status).toBe('idle');
  });

  it('persists agent data to disk', async () => {
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('chat', hm);

    const result = await manager.createAgent({
      conversationContext: ctx,
      parentConversation: 'chat',
      agentName: 'persist-test',
    });

    // Check that file was created
    const filePath = path.join(tmpDir, '.agents', `${result.agentId}.json`);
    const stat = await fs.promises.stat(filePath);
    expect(stat.isFile()).toBe(true);

    // Verify content
    const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    expect(data.name).toBe('persist-test');
    expect(data.parentConversation).toBe('chat');
  });

  it('enforces max concurrent agents limit', async () => {
    // Create 10 agents (the limit)
    for (let i = 0; i < 10; i++) {
      const hm = createMockHistoryManager();
      const ctx = new ConversationContext(`chat-${i}`, hm);
      await manager.createAgent({
        conversationContext: ctx,
        parentConversation: `chat-${i}`,
        agentName: `agent-${i}`,
      });
    }

    // The 11th should fail
    const hm = createMockHistoryManager();
    const ctx = new ConversationContext('chat-overflow', hm);
    await expect(
      manager.createAgent({
        conversationContext: ctx,
        parentConversation: 'chat-overflow',
      })
    ).rejects.toThrow('Maximum concurrent agents');
  });
});
