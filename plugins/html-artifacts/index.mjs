import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultType: 'html',
  maxArtifactSizeKB: 512,
  broadcastOnSave: true,
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable HTML artifact rendering', default: true },
  { key: 'defaultType', label: 'Default Artifact Type', type: 'select', description: 'Default type for new artifacts', default: 'html', options: ['html', 'react'] },
  { key: 'maxArtifactSizeKB', label: 'Max Artifact Size (KB)', type: 'number', description: 'Maximum size in KB for saved artifacts', default: 512 },
  { key: 'broadcastOnSave', label: 'Broadcast on Save', type: 'boolean', description: 'Broadcast a WS event when an artifact is saved', default: true },
];

export async function activate(api) {
  const { pluginSettings } = await registerSettingsHandlers(
    api, 'html-artifacts', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

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
      if (!pluginSettings.enabled) {
        return { success: false, message: 'HTML Artifacts plugin is disabled' };
      }
      const maxBytes = (pluginSettings.maxArtifactSizeKB || 512) * 1024;
      if (args.content && args.content.length > maxBytes) {
        return { success: false, message: `Artifact exceeds max size of ${pluginSettings.maxArtifactSizeKB} KB` };
      }
      await api.storage.set(`artifact:${args.id}`, args);
      // Broadcast to any connected surface/clients
      if (pluginSettings.broadcastOnSave) {
        api.ws.broadcast('html-artifacts:saved', { id: args.id, type: args.type });
      }
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
    if (pluginSettings.broadcastOnSave) {
      api.ws.broadcast('html-artifacts:saved', { id: payload.id, type: payload.type });
    }
    return { success: true };
  });

  api.ws.register('html-artifacts:load', async (payload) => {
    return await api.storage.get(`artifact:${payload.id}`);
  });

}

export function deactivate(api) {
  // Cleanup if necessary
}
