import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultResultLimit: 5,
  snippetLength: 500,
  fallbackToKeywordSearch: true,
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable semantic search', default: true },
  { key: 'defaultResultLimit', label: 'Default Result Limit', type: 'number', description: 'Default maximum number of search results to return', default: 5 },
  { key: 'snippetLength', label: 'Snippet Length', type: 'number', description: 'Maximum character length of document snippets sent to the AI for ranking', default: 500 },
  { key: 'fallbackToKeywordSearch', label: 'Fallback to Keyword Search', type: 'boolean', description: 'Fall back to keyword matching if AI ranking fails', default: true },
];

export async function activate(api) {
  const { pluginSettings } = await registerSettingsHandlers(
    api, 'semantic-search', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

  api.tools.register({
    name: 'store_content',
    description: 'Store a document or information in the knowledge base for semantic search',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the document' },
        content: { type: 'string', description: 'The text content to store' }
      },
      required: ['id', 'content']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ id, content }) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Semantic search plugin is disabled' };
      }
      const docIds = await api.storage.get('semantic_doc_ids') || [];
      if (!docIds.includes(id)) {
        docIds.push(id);
        await api.storage.set('semantic_doc_ids', docIds);
      }
      await api.storage.set(`semantic_doc:${id}`, content);
      return { success: true, id, message: 'Content stored successfully' };
    }
  });

  api.tools.register({
    name: 'search_content',
    description: 'Search the knowledge base for conceptually related information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The semantic query or concept to search for' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: from settings)' }
      },
      required: ['query']
    },
    useOriginalName: true,
    surfaceSafe: true,
    handler: async ({ query, limit }) => {
      if (!pluginSettings.enabled) {
        return { results: [], message: 'Semantic search plugin is disabled' };
      }

      const resultLimit = limit || pluginSettings.defaultResultLimit;
      const snippetLen = pluginSettings.snippetLength;
      const docIds = await api.storage.get('semantic_doc_ids') || [];
      if (docIds.length === 0) {
        return { results: [], message: 'Knowledge base is empty' };
      }

      // Load all documents
      const docs = [];
      for (const id of docIds) {
        const content = await api.storage.get(`semantic_doc:${id}`);
        if (content) {
          docs.push({ id, content });
        }
      }

      // Since we don't have local embeddings readily available, we can use the LLM
      // to rank the documents by semantic relevance. To avoid massive token usage,
      // we only send short snippets or process in batches if needed. 
      // For this implementation, we will send all docs to the LLM and ask for relevance scores.
      
      const prompt = `You are a semantic search engine.
Query: "${query}"

Documents:
${docs.map(d => `--- Document ID: ${d.id} ---\n${d.content.substring(0, snippetLen)}...\n`).join('\n')}

Task: Analyze the documents and return a JSON array of the top ${resultLimit} most relevant document IDs, ordered by relevance. If none are relevant, return an empty array.
Format strictly as JSON array of strings: ["id1", "id2"]`;

      try {
        const aiResponse = await api.ai.ask(prompt, { system: 'You output only valid JSON.' });
        
        let rankedIds = [];
        try {
          // Extract JSON array from response
          const jsonMatch = aiResponse.match(/\[.*\]/s);
          if (jsonMatch) {
            rankedIds = JSON.parse(jsonMatch[0]);
          } else {
            rankedIds = JSON.parse(aiResponse);
          }
        } catch (e) {
          consoleStyler.logError('error', `Failed to parse AI response as JSON: ${aiResponse}`, e);
          // Fallback to naive keyword match if AI fails to return JSON
          if (pluginSettings.fallbackToKeywordSearch) {
            const keywords = query.toLowerCase().split(' ');
            rankedIds = docs
              .map(d => {
                const score = keywords.reduce((acc, kw) => acc + (d.content.toLowerCase().includes(kw) ? 1 : 0), 0);
                return { id: d.id, score };
              })
              .filter(d => d.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, resultLimit)
              .map(d => d.id);
          }
        }

        const results = rankedIds
          .slice(0, resultLimit)
          .map(id => docs.find(d => d.id === id))
          .filter(Boolean);

        return { results, query };
      } catch (error) {
        return { error: error.message };
      }
    }
  });

}

export function deactivate(api) {
  // Cleanup
}
