/**
 * Oboto Web Search Plugin
 *
 * Provides web search via the Serper.dev API.
 * Extracted from src/execution/handlers/web-handlers.mjs and
 * src/tools/definitions/web-tools.mjs.
 *
 * @module @oboto/plugin-web-search
 */

import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

// ── Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    serperApiKey: '',
    defaultNumResults: 10,
    fetchTimeout: 15000,
};

const SETTINGS_SCHEMA = [
    {
        key: 'serperApiKey',
        label: 'Serper API Key',
        type: 'password',
        description: 'Serper API key for web search',
        default: '',
    },
    {
        key: 'defaultNumResults',
        label: 'Default Number of Results',
        type: 'number',
        description: 'Default number of search results',
        default: 10,
        min: 1,
        max: 100,
    },
    {
        key: 'fetchTimeout',
        label: 'URL Fetch Timeout (ms)',
        type: 'number',
        description: 'URL fetch timeout (ms)',
        default: 15000,
        min: 5000,
        max: 60000,
    },
];

// ── Tool Handlers ────────────────────────────────────────────────────────

async function handleSearchWeb(apiKey, args) {
    const {
        query,
        type = 'search',
        num = 10,
        location,
        lang = 'en',
        safe = 'active'
    } = args;

    if (!apiKey) {
        return 'Error: Serper API key is not configured. Set SERPER_API_KEY or configure in plugin settings.';
    }

    try {
        const searchParams = { q: query, type, num, lang, safe };

        if (location) {
            searchParams.location = location;
        }

        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(searchParams)
        });

        if (!response.ok) {
            throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Format the results
        let formattedResults = `# Web Search Results for: "${query}"\n\n`;

        // Search summary
        if (data.searchParameters) {
            formattedResults += `**Search Parameters:**\n`;
            formattedResults += `- Query: ${data.searchParameters.q}\n`;
            formattedResults += `- Type: ${data.searchParameters.type || 'search'}\n`;
            formattedResults += `- Results: ${data.searchParameters.num || 10}\n`;
            if (data.searchParameters.location) {
                formattedResults += `- Location: ${data.searchParameters.location}\n`;
            }
            formattedResults += `\n`;
        }

        // Answer box
        if (data.answerBox) {
            formattedResults += `## Quick Answer\n`;
            formattedResults += `**${data.answerBox.title || 'Answer'}**\n`;
            formattedResults += `${data.answerBox.answer || data.answerBox.snippet}\n`;
            if (data.answerBox.source) {
                formattedResults += `*Source: ${data.answerBox.source}*\n`;
            }
            formattedResults += `\n`;
        }

        // Knowledge graph
        if (data.knowledgeGraph) {
            formattedResults += `## Knowledge Graph\n`;
            formattedResults += `**${data.knowledgeGraph.title}**\n`;
            if (data.knowledgeGraph.description) {
                formattedResults += `${data.knowledgeGraph.description}\n`;
            }
            if (data.knowledgeGraph.source) {
                formattedResults += `*Source: ${data.knowledgeGraph.source.name}*\n`;
            }
            formattedResults += `\n`;
        }

        // Organic results
        if (data.organic && data.organic.length > 0) {
            formattedResults += `## Search Results\n\n`;
            data.organic.forEach((result, index) => {
                formattedResults += `### ${index + 1}. ${result.title}\n`;
                formattedResults += `**URL:** ${result.link}\n`;
                if (result.snippet) {
                    formattedResults += `**Description:** ${result.snippet}\n`;
                }
                if (result.date) {
                    formattedResults += `**Date:** ${result.date}\n`;
                }
                formattedResults += `\n`;
            });
        }

        // News results
        if (data.news && data.news.length > 0) {
            formattedResults += `## Related News\n\n`;
            data.news.forEach((news, index) => {
                formattedResults += `### ${index + 1}. ${news.title}\n`;
                formattedResults += `**URL:** ${news.link}\n`;
                if (news.snippet) {
                    formattedResults += `**Description:** ${news.snippet}\n`;
                }
                if (news.date) {
                    formattedResults += `**Date:** ${news.date}\n`;
                }
                if (news.source) {
                    formattedResults += `**Source:** ${news.source}\n`;
                }
                formattedResults += `\n`;
            });
        }

        // People also ask
        if (data.peopleAlsoAsk && data.peopleAlsoAsk.length > 0) {
            formattedResults += `## People Also Ask\n\n`;
            data.peopleAlsoAsk.forEach((question, index) => {
                formattedResults += `${index + 1}. ${question.question}\n`;
                if (question.snippet) {
                    formattedResults += `   ${question.snippet}\n`;
                }
                formattedResults += `\n`;
            });
        }

        // Related searches
        if (data.relatedSearches && data.relatedSearches.length > 0) {
            formattedResults += `## Related Searches\n\n`;
            data.relatedSearches.forEach((search, index) => {
                formattedResults += `${index + 1}. ${search.query}\n`;
            });
            formattedResults += `\n`;
        }

        return formattedResults;

    } catch (error) {
        return `Error performing web search: ${error.message}`;
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    // Pre-create instance object to avoid race condition with onSettingsChange callback
    const instanceState = { settings: null };
    api.setInstance(instanceState);

    const { pluginSettings } = await registerSettingsHandlers(
        api, 'web-search', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
        () => {
            instanceState.settings = pluginSettings;
        }
    );

    instanceState.settings = pluginSettings;

    // Resolve API key: plugin settings first, then environment variable
    const getApiKey = async () =>
        (await api.settings.get('serperApiKey')) || process.env.SERPER_API_KEY || '';

    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'search_web',
        description:
            'Searches the web using Serper.dev API to find current information, news, or answer questions that require up-to-date data. Provides comprehensive search results with snippets and links.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to find information on the web'
                },
                type: {
                    type: 'string',
                    enum: ['search', 'news', 'images', 'videos', 'places', 'shopping'],
                    description: 'Type of search to perform',
                    default: 'search'
                },
                num: {
                    type: 'number',
                    description: `Number of results to return (1-100). Default ${pluginSettings.defaultNumResults}.`,
                    minimum: 1,
                    maximum: 100,
                    default: pluginSettings.defaultNumResults
                },
                location: {
                    type: 'string',
                    description: "Geographic location for localized results (e.g., 'New York, NY, USA')"
                },
                lang: {
                    type: 'string',
                    description: "Language code for results (e.g., 'en', 'es', 'fr')",
                    default: 'en'
                },
                safe: {
                    type: 'string',
                    enum: ['active', 'off'],
                    description: 'Safe search setting',
                    default: 'active'
                }
            },
            required: ['query']
        },
        handler: async (args) => {
            const mergedArgs = { ...args, num: args.num ?? pluginSettings.defaultNumResults };
            return handleSearchWeb(await getApiKey(), mergedArgs);
        }
    });

}

export async function deactivate(api) {
    api.setInstance(null);
}
