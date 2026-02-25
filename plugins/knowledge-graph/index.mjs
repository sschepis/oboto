import { GraphStore } from './graph-store.mjs';
import { MemoryFieldStore } from './memory-field-store.mjs';
import { HolographicProjection } from './holographic-projection.mjs';
import { SemanticComputing } from './semantic-computing.mjs';

// NOTE: Plugin state is stored on `api._pluginInstance` rather than in module-level
// variables. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up state via `api._pluginInstance`, and the new module
// starts fresh.

export async function activate(api) {
  console.log('[Knowledge Graph] Activating...');

  const graphStore = new GraphStore(api);
  await graphStore.activate();

  const memoryStore = new MemoryFieldStore(api);
  await memoryStore.init();

  const holographicProjection = new HolographicProjection();
  const semanticComputing = new SemanticComputing(memoryStore);

  // Store instances on api so deactivate() can access them even after ESM reload
  api._pluginInstance = { graphStore, memoryStore, holographicProjection, semanticComputing };

  // Register Tools

  api.tools.register({
    name: 'query_knowledge',
    description: 'Query the knowledge graph for entities and relationships. Use subject/predicate/object patterns to find matching triples.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Subject entity ID or name to match (optional)' },
        predicate: { type: 'string', description: 'Relationship type to match (optional)' },
        object: { type: 'string', description: 'Object entity ID or name to match (optional)' },
        limit: { type: 'number', description: 'Maximum number of results (default: 20)' }
      }
    },
    handler: async (args) => graphStore.query(args.subject, args.predicate, args.object, args.limit)
  });

  api.tools.register({
    name: 'add_knowledge',
    description: 'Add new knowledge to the graph. Creates entities and relationships between concepts.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'The subject entity (source of the relationship)' },
        predicate: { type: 'string', description: 'The relationship type (e.g., "is_a", "has_property", "related_to")' },
        object: { type: 'string', description: 'The object entity (target of the relationship)' },
        subjectType: { type: 'string', description: 'Type of the subject entity (e.g., "person", "concept", "organization")' },
        objectType: { type: 'string', description: 'Type of the object entity' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score for this knowledge (0-1)' },
        source: { type: 'string', description: 'Source of this knowledge (e.g., "user", "inference", "external")' }
      },
      required: ['subject', 'predicate', 'object']
    },
    handler: async (args) => graphStore.addKnowledge(args)
  });

  api.tools.register({
    name: 'get_related_entities',
    description: 'Get all entities related to a given entity, traversing the knowledge graph.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'The ID or name of the entity to explore' },
        depth: { type: 'number', minimum: 1, maximum: 5, description: 'How many hops to traverse (default: 2)' },
        relationTypes: { type: 'array', items: { type: 'string' }, description: 'Filter by specific relationship types' }
      },
      required: ['entityId']
    },
    handler: async (args) => graphStore.getRelated(args.entityId, args.depth, args.relationTypes)
  });

  api.tools.register({
    name: 'search_knowledge',
    description: 'Search entities in the knowledge graph by text query and/or type.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in entity names and properties' },
        type: { type: 'string', description: 'Filter by entity type' },
        limit: { type: 'number', description: 'Maximum results (default: 20)' }
      },
      required: []
    },
    handler: async (args) => graphStore.searchEntities(args.query, args.type, args.limit)
  });

  api.tools.register({
    name: 'semantic_think',
    description: 'Analyze text for themes, coherence, and insights. Returns structured analysis.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to analyze' },
        depth: { type: 'string', enum: ['shallow', 'normal', 'deep'], description: 'Analysis depth' }
      },
      required: ['text']
    },
    handler: async (args) => semanticComputing.think(args.text, args.depth)
  });

  api.tools.register({
    name: 'semantic_remember',
    description: 'Store information in long-term memory for later recall.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to remember' },
        importance: { type: 'number', description: 'Importance level (0-1)' }
      },
      required: ['content']
    },
    handler: async (args) => semanticComputing.remember(args.content, args.importance)
  });

  api.tools.register({
    name: 'semantic_recall',
    description: 'Recall previously stored memories matching a query.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for memories' },
        limit: { type: 'number', description: 'Max results (default: 10)' }
      },
      required: ['query']
    },
    handler: async (args) => semanticComputing.recall(args.query, args.limit)
  });

  // Register WebSocket Handlers
  api.ws.register('kg:query', async (data) => graphStore.query(data.subject, data.predicate, data.object));
  api.ws.register('kg:insert', async (data) => graphStore.insert(data));
  api.ws.register('kg:add-entity', async (data) => graphStore.addEntity(data));
  api.ws.register('kg:get-entity', async (data) => graphStore.getEntity(data.id));
  api.ws.register('kg:search-entities', async (data) => graphStore.searchEntities(data.query, data.type));
  api.ws.register('kg:get-related', async (data) => graphStore.getRelated(data.entityId, data.depth));
  api.ws.register('kg:get-graph', async () => graphStore.getGraph());
  api.ws.register('kg:clear', async () => graphStore.clear());

  api.ws.register('memory:create', async (data) => memoryStore.createField(data));
  api.ws.register('memory:list', async (data) => memoryStore.listFields(data.scope, data.includePublic));
  api.ws.register('memory:get', async (data) => memoryStore.getField(data.fieldId));
  api.ws.register('memory:join', async (data) => memoryStore.joinField(data.fieldId));
  api.ws.register('memory:delete', async (data) => memoryStore.deleteField(data.fieldId, data.force));
  api.ws.register('memory:store', async (data) => memoryStore.storeFragment(data));
  api.ws.register('memory:query', async (data) => memoryStore.queryFragments(data));
  api.ws.register('memory:queryGlobal', async (data) => memoryStore.queryGlobal(data));
  api.ws.register('memory:contribute', async (data) => memoryStore.contribute(data.fieldId, data.content));
  api.ws.register('memory:sync', async (data) => memoryStore.syncFields(data));
  api.ws.register('memory:entropy', async (data) => memoryStore.getEntropy(data.fieldId));
  api.ws.register('memory:checkpoint', async (data) => memoryStore.createCheckpoint(data.fieldId));
  api.ws.register('memory:rollback', async (data) => memoryStore.rollback(data.fieldId, data.checkpointId));
  
  api.ws.register('memory:project', async (data) => holographicProjection.project(data.text, data.gridSize));
  api.ws.register('memory:reconstruct', async (data) => holographicProjection.reconstruct(data.pattern));
  api.ws.register('memory:similarity', async (data) => holographicProjection.similarity(data.fragment1, data.fragment2));

  api.ws.register('aleph:think', async (data) => semanticComputing.think(data.text, data.depth));
  api.ws.register('aleph:compare', async (data) => semanticComputing.compare(data.text1, data.text2));
  api.ws.register('aleph:remember', async (data) => semanticComputing.remember(data.content, data.importance));
  api.ws.register('aleph:recall', async (data) => semanticComputing.recall(data.query, data.limit));
  api.ws.register('aleph:introspect', async () => semanticComputing.introspect());
  api.ws.register('aleph:focus', async (data) => semanticComputing.focus(data.topics, data.duration));

  console.log('[Knowledge Graph] Activated successfully');
}

export async function deactivate(api) {
  if (api._pluginInstance) {
    const { graphStore, memoryStore } = api._pluginInstance;
    if (graphStore) await graphStore.saveToStorage();
    if (memoryStore) await memoryStore.save();
  }
  api._pluginInstance = null;
  console.log('[Knowledge Graph] Deactivated');
}
