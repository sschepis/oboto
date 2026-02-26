import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  maxNotes: 500,
  broadcastChanges: true,
  defaultTitle: 'Untitled Note',
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable note taking', default: true },
  { key: 'maxNotes', label: 'Max Notes', type: 'number', description: 'Maximum number of notes to keep', default: 500 },
  { key: 'broadcastChanges', label: 'Broadcast Changes', type: 'boolean', description: 'Broadcast WS events on note save/delete', default: true },
  { key: 'defaultTitle', label: 'Default Title', type: 'text', description: 'Default title for notes without one', default: 'Untitled Note' },
];

export async function activate(api) {
  const { pluginSettings } = await registerSettingsHandlers(
    api, 'note-taker', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

  // Use api.storage to manage notes
  // A 'notes_index' key will keep track of note IDs, and each note will be stored as `note:${id}`

  const getNotesIndex = async () => {
    return await api.storage.get('notes_index') || [];
  };

  const saveNotesIndex = async (index) => {
    await api.storage.set('notes_index', index);
  };

  // Tools
  api.tools.register({
    name: 'save_note',
    description: 'Save a new note or update an existing one',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the note' },
        title: { type: 'string', description: 'Title of the note' },
        content: { type: 'string', description: 'Content of the note' }
      },
      required: ['id', 'title', 'content']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id, title, content }) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Note Taker plugin is disabled' };
      }
      const index = await getNotesIndex();
      if (!index.includes(id)) {
        if (index.length >= (pluginSettings.maxNotes || 500)) {
          return { success: false, message: `Maximum note limit (${pluginSettings.maxNotes}) reached` };
        }
        index.push(id);
        await saveNotesIndex(index);
      }
      const note = {
        id,
        title: title || pluginSettings.defaultTitle,
        content,
        timestamp: Date.now()
      };
      await api.storage.set(`note:${id}`, note);
      
      // Emit an event or broadcast so UI can update
      if (pluginSettings.broadcastChanges) {
        api.ws.broadcast('note-taker:note-saved', note);
      }
      
      return { success: true, id, message: 'Note saved successfully' };
    }
  });

  api.tools.register({
    name: 'list_notes',
    description: 'List all available notes',
    parameters: { type: 'object', properties: {} },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async () => {
      const index = await getNotesIndex();
      const notes = [];
      for (const id of index) {
        const note = await api.storage.get(`note:${id}`);
        if (note) {
          notes.push({ id: note.id, title: note.title, timestamp: note.timestamp });
        }
      }
      return { notes };
    }
  });

  api.tools.register({
    name: 'get_note',
    description: 'Retrieve the content of a specific note by ID',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Note ID to retrieve' }
      },
      required: ['id']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id }) => {
      const note = await api.storage.get(`note:${id}`);
      if (!note) {
        throw new Error(`Note not found: ${id}`);
      }
      return note;
    }
  });

  api.tools.register({
    name: 'delete_note',
    description: 'Delete a note by ID',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Note ID to delete' }
      },
      required: ['id']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id }) => {
      const index = await getNotesIndex();
      const newIndex = index.filter(n => n !== id);
      await saveNotesIndex(newIndex);
      await api.storage.set(`note:${id}`, null);
      
      if (pluginSettings.broadcastChanges) {
        api.ws.broadcast('note-taker:note-deleted', { id });
      }
      return { success: true, message: 'Note deleted' };
    }
  });

  // WS Handlers for UI clients
  api.ws.register('note-taker:list-notes', async () => {
    const index = await getNotesIndex();
    const notes = [];
    for (const id of index) {
      const note = await api.storage.get(`note:${id}`);
      if (note) {
        notes.push(note);
      }
    }
    return { notes };
  });

  api.ws.register('note-taker:save-note', async (payload) => {
    const { id, title, content } = payload;
    const index = await getNotesIndex();
    if (!index.includes(id)) {
      if (index.length >= (pluginSettings.maxNotes || 500)) {
        return { success: false, message: `Maximum note limit (${pluginSettings.maxNotes}) reached` };
      }
      index.push(id);
      await saveNotesIndex(index);
    }
    const note = { id, title: title || pluginSettings.defaultTitle, content, timestamp: Date.now() };
    await api.storage.set(`note:${id}`, note);
    if (pluginSettings.broadcastChanges) {
      api.ws.broadcast('note-taker:note-saved', note);
    }
    return { success: true, note };
  });

  api.ws.register('note-taker:get-note', async (payload) => {
    return await api.storage.get(`note:${payload.id}`);
  });

  api.ws.register('note-taker:delete-note', async (payload) => {
    const { id } = payload;
    const index = await getNotesIndex();
    const newIndex = index.filter(n => n !== id);
    await saveNotesIndex(newIndex);
    await api.storage.set(`note:${id}`, null);
    if (pluginSettings.broadcastChanges) {
      api.ws.broadcast('note-taker:note-deleted', { id });
    }
    return { success: true };
  });

}

export function deactivate(api) {
  // Cleanup if necessary
}
