import { consoleStyler } from '../../ui/console-styler.mjs';

export class WebHandlers {
    async searchWeb(args) {
        const {
            query,
            type = 'search',
            num = 10,
            location,
            lang = 'en',
            safe = 'active'
        } = args;

        // Your API key
        const apiKey = process.env.SERPER_API_KEY || '7edbc239394bb9b75ce5543fb6987ba4256b3269';
        
        consoleStyler.log('working', `🔍 Searching web for: "${query}"`);
        consoleStyler.log('working', `   Search type: ${type}, Results: ${num}`, { indent: true });
        
        try {
            const searchParams = {
                q: query,
                type: type,
                num: num,
                lang: lang,
                safe: safe
            };

            // Add location if specified
            if (location) {
                searchParams.location = location;
                consoleStyler.log('working', `   Location: ${location}`, { indent: true });
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
            
            consoleStyler.log('tools', `✓ Web search completed - found ${data.organic?.length || 0} results`);

            // Format the results
            let formattedResults = `# Web Search Results for: "${query}"\n\n`;
            
            // Add search summary if available
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

            // Add answer box if available
            if (data.answerBox) {
                formattedResults += `## Quick Answer\n`;
                formattedResults += `**${data.answerBox.title || 'Answer'}**\n`;
                formattedResults += `${data.answerBox.answer || data.answerBox.snippet}\n`;
                if (data.answerBox.source) {
                    formattedResults += `*Source: ${data.answerBox.source}*\n`;
                }
                formattedResults += `\n`;
            }

            // Add knowledge graph if available
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

            // Add organic results
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

            // Add news results if available
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

            // Add people also ask if available
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

            // Add related searches if available
            if (data.relatedSearches && data.relatedSearches.length > 0) {
                formattedResults += `## Related Searches\n\n`;
                
                data.relatedSearches.forEach((search, index) => {
                    formattedResults += `${index + 1}. ${search.query}\n`;
                });
                formattedResults += `\n`;
            }

            return formattedResults;

        } catch (error) {
            consoleStyler.log('error', `Web search failed: ${error.message}`, { box: true });
            return `Error performing web search: ${error.message}`;
        }
    }
}
