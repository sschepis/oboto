/**
 * Oboto Firecrawl Plugin
 *
 * Provides web scraping and crawling tools via the Firecrawl API.
 * Extracted from src/execution/handlers/firecrawl-handlers.mjs and
 * src/tools/definitions/firecrawl-tools.mjs.
 *
 * @module @oboto/plugin-firecrawl
 */

const BASE_URL = 'https://api.firecrawl.dev/v1';

/**
 * Resolve the Firecrawl API key from plugin settings or environment.
 * @param {object} settings — plugin settings store
 * @returns {string}
 */
async function resolveApiKey(settings) {
    const fromSettings = await settings.get('apiKey');
    const key = fromSettings || process.env.FIRECRAWL_API_KEY;
    if (!key) {
        throw new Error('FIRECRAWL_API_KEY is not set. Configure it in plugin settings or the environment.');
    }
    return key;
}

// ── Tool Handlers ────────────────────────────────────────────────────────

async function handleScrape(args, settings) {
    const apiKey = await resolveApiKey(settings);
    const { url, formats = ['markdown'], onlyMainContent = true, waitFor = 0 } = args;

    try {
        const response = await fetch(`${BASE_URL}/scrape`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ url, formats, onlyMainContent, waitFor })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Firecrawl API Error: ${response.status} ${response.statusText} - ${error}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(`Firecrawl failed: ${data.error || 'Unknown error'}`);
        }

        return JSON.stringify(data.data, null, 2);
    } catch (error) {
        return `Error scraping ${url}: ${error.message}`;
    }
}

async function handleCrawl(args, settings) {
    const apiKey = await resolveApiKey(settings);
    const { url, limit = 10, scrapeOptions = {} } = args;

    try {
        const response = await fetch(`${BASE_URL}/crawl`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ url, limit, scrapeOptions })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Firecrawl API Error: ${response.status} ${response.statusText} - ${error}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(`Firecrawl failed: ${data.error || 'Unknown error'}`);
        }

        return `Crawl started successfully.\nJob ID: ${data.id}\nUse 'firecrawl_check_job' to check status.`;
    } catch (error) {
        return `Error starting crawl for ${url}: ${error.message}`;
    }
}

async function handleCheckJob(args, settings) {
    const apiKey = await resolveApiKey(settings);
    const { jobId } = args;

    try {
        const response = await fetch(`${BASE_URL}/crawl/${jobId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Firecrawl API Error: ${response.status} ${response.statusText} - ${error}`);
        }

        const data = await response.json();

        if (!data.success) {
            return `Job status check failed: ${data.error || 'Unknown error'}`;
        }

        const status = data.status || data.data?.status;
        const completed = data.completed || data.data?.completed || 0;
        const total = data.total || data.data?.total || 0;
        const creditsUsed = data.creditsUsed || data.data?.creditsUsed || 0;
        const expiresAt = data.expiresAt || data.data?.expiresAt;

        let result = `Job ID: ${jobId}\nStatus: ${status}\nProgress: ${completed}/${total}\nCredits Used: ${creditsUsed}\nExpires: ${expiresAt}`;

        if (status === 'completed' && data.data) {
            const items = data.data
                .map(item => `- ${item.metadata?.title || item.url || 'No Title'} (${item.url})`)
                .join('\n');
            result += `\n\nResults:\n${items}\n\n(Full data is too large to display, but is available in context)`;
        }

        return result;
    } catch (error) {
        return `Error checking job ${jobId}: ${error.message}`;
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const { settings } = api;

    api.tools.register({
        useOriginalName: true,
        name: 'firecrawl_scrape',
        description: 'Scrape a single URL using Firecrawl. Returns clean markdown, HTML, or other formats. Best for reading a specific page.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to scrape'
                },
                formats: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['markdown', 'html', 'rawHtml', 'links', 'screenshot']
                    },
                    description: "Formats to return. Default is ['markdown'].",
                    default: ['markdown']
                },
                onlyMainContent: {
                    type: 'boolean',
                    description: 'If true, excludes header/footer/nav. Default true.',
                    default: true
                },
                waitFor: {
                    type: 'number',
                    description: 'Time to wait in ms before scraping (for dynamic content). Default 0.'
                }
            },
            required: ['url']
        },
        handler: (args) => handleScrape(args, settings)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'firecrawl_crawl',
        description: 'Crawl a website starting from a URL using Firecrawl. Returns a job ID to check status or the results if fast. Best for mapping a site.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The base URL to start crawling'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of pages to crawl. Default 10.',
                    default: 10
                },
                scrapeOptions: {
                    type: 'object',
                    description: 'Options for scraping each page (formats, onlyMainContent, etc.)'
                }
            },
            required: ['url']
        },
        handler: (args) => handleCrawl(args, settings)
    });

    api.tools.register({
        useOriginalName: true,
        name: 'firecrawl_check_job',
        description: 'Check the status of a Firecrawl crawl job.',
        parameters: {
            type: 'object',
            properties: {
                jobId: {
                    type: 'string',
                    description: 'The Job ID returned by firecrawl_crawl'
                }
            },
            required: ['jobId']
        },
        handler: (args) => handleCheckJob(args, settings)
    });
}

export async function deactivate(_api) {
    // Cleanup handled automatically by PluginAPI._cleanup()
}
