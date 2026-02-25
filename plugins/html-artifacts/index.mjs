export function activate(api) {
  api.tools.register({
    name: 'save_artifact',
    description: 'Save an HTML/React artifact for preview',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the artifact' },
        content: { type: 'string', description: 'HTML or JSX code' },
        type: { type: 'string', enum: ['html', 'react'], description: 'Type of artifact' }
      },
      required: ['id', 'content', 'type']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async (args) => {
      await api.storage.set(`artifact:${args.id}`, args);
      // Broadcast to any connected surface/clients
      api.ws.broadcast('html-artifacts:saved', { id: args.id, type: args.type });
      return { success: true, id: args.id, message: 'Artifact saved successfully' };
    }
  });

  api.tools.register({
    name: 'load_artifact',
    description: 'Load an HTML/React artifact by ID',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the artifact' }
      },
      required: ['id']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async (args) => {
      const artifact = await api.storage.get(`artifact:${args.id}`);
      if (!artifact) {
        throw new Error(`Artifact with ID ${args.id} not found`);
      }
      return artifact;
    }
  });

  api.ws.register('html-artifacts:save', async (payload) => {
    await api.storage.set(`artifact:${payload.id}`, payload);
    api.ws.broadcast('html-artifacts:saved', { id: payload.id, type: payload.type });
    return { success: true };
  });

  api.ws.register('html-artifacts:load', async (payload) => {
    return await api.storage.get(`artifact:${payload.id}`);
  });
}

export function deactivate(api) {
  // Cleanup if necessary
}
