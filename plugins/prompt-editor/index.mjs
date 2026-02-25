export function activate(api) {
  // ChainManager using api.storage
  class ChainManager {
    async initialize() {
      const chains = await api.storage.get('chains_index') || [];
      if (!Array.isArray(chains)) {
        await api.storage.set('chains_index', []);
      }
    }

    async listChains() {
      return await api.storage.get('chains_index') || [];
    }

    async getChain(id) {
      return await api.storage.get(`chain:${id}`);
    }

    async saveChain(id, config) {
      const chains = await this.listChains();
      if (!chains.includes(id)) {
        chains.push(id);
        await api.storage.set('chains_index', chains);
      }
      await api.storage.set(`chain:${id}`, config);
    }

    async deleteChain(id) {
      const chains = await this.listChains();
      const newChains = chains.filter(c => c !== id);
      await api.storage.set('chains_index', newChains);
      // We could delete the specific key, but api.storage might not have a delete method.
      // We can just set it to null.
      await api.storage.set(`chain:${id}`, null);
    }
  }

  const chainManager = new ChainManager();
  chainManager.initialize();

  // WS Handlers
  api.ws.register('prompt-editor:list-chains', async () => {
    return await chainManager.listChains();
  });

  api.ws.register('prompt-editor:get-chain', async (payload) => {
    return await chainManager.getChain(payload.id);
  });

  api.ws.register('prompt-editor:save-chain', async (payload) => {
    await chainManager.saveChain(payload.id, payload.config);
    return { success: true };
  });

  api.ws.register('prompt-editor:delete-chain', async (payload) => {
    await chainManager.deleteChain(payload.id);
    return { success: true };
  });

  api.ws.register('prompt-editor:execute-chain', async (payload) => {
    const { id, input } = payload;
    const config = await chainManager.getChain(id);
    if (!config) throw new Error('Chain not found');

    const startPrompt = config.prompts?.[0];
    if (!startPrompt) throw new Error('No prompts in chain');

    const systemPrompt = startPrompt.system || '';
    let userPrompt = startPrompt.user || '';
    
    // Simple template replacement for input
    if (input) {
      for (const [key, value] of Object.entries(input)) {
        userPrompt = userPrompt.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
      }
    }

    api.ws.broadcast('chain-execution-update', { type: 'node-start', nodeId: startPrompt.name, timestamp: Date.now() });
    
    try {
      // Use api.ai.ask instead of workflow runner
      const fullPrompt = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;
      const result = await api.ai.ask(fullPrompt, { system: systemPrompt });
      
      api.ws.broadcast('chain-execution-update', { 
        type: 'node-complete', 
        nodeId: startPrompt.name, 
        result: { response: result },
        timestamp: Date.now() 
      });
      
      return { success: true, result: { response: result } };
    } catch (error) {
      api.ws.broadcast('chain-execution-update', { 
        type: 'node-error', 
        nodeId: startPrompt.name, 
        error: error.message,
        timestamp: Date.now() 
      });
      return { success: false, error: error.message };
    }
  });

  // Tools
  api.tools.register({
    name: 'list_prompt_chains',
    description: 'List available prompt chains',
    parameters: { type: 'object', properties: {} },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async () => {
      return await chainManager.listChains();
    }
  });

  api.tools.register({
    name: 'read_prompt_chain',
    description: 'Read a prompt chain configuration',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Chain ID' }
      },
      required: ['id']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id }) => {
      return await chainManager.getChain(id);
    }
  });

  api.tools.register({
    name: 'write_prompt_chain',
    description: 'Create or update a prompt chain',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Chain ID' },
        config: { type: 'object', description: 'Chain configuration object' }
      },
      required: ['id', 'config']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id, config }) => {
      await chainManager.saveChain(id, config);
      return { success: true };
    }
  });

  api.tools.register({
    name: 'execute_prompt_chain',
    description: 'Execute a prompt chain',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Chain ID' },
        input: { type: 'object', description: 'Input variables for the chain' }
      },
      required: ['id']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id, input }) => {
      const config = await chainManager.getChain(id);
      if (!config) throw new Error('Chain not found');

      const startPrompt = config.prompts?.[0];
      if (!startPrompt) throw new Error('No prompts in chain');

      const systemPrompt = startPrompt.system || '';
      let userPrompt = startPrompt.user || '';
      
      if (input) {
        for (const [key, value] of Object.entries(input)) {
          userPrompt = userPrompt.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
        }
      }

      const fullPrompt = `System: ${systemPrompt}\n\nUser: ${userPrompt}`;
      const result = await api.ai.ask(fullPrompt, { system: systemPrompt });
      
      return { success: true, result: { response: result } };
    }
  });
}

export function deactivate(api) {
  // Cleanup if needed
}
