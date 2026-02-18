import { consoleStyler } from '../../ui/console-styler.mjs';

export class FirecrawlHandlers {
    constructor() {
        this.apiKey = process.env.FIRECRAWL_API_KEY;
        this.baseUrl = 'https://api.firecrawl.dev/v1';
    }

    async ensureApiKey() {
        if (!this.apiKey) {
            throw new Error("FIRECRAWL_API_KEY is not set in the environment.");
        }
    }

    async firecrawlScrape(args) {
        await this.ensureApiKey();
        const { url, formats = ['markdown'], onlyMainContent = true, waitFor = 0 } = args;

        consoleStyler.log('working', `Firecrawl Scrape: ${url}`);

        try {
            const response = await fetch(`${this.baseUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    url,
                    formats,
                    onlyMainContent,
                    waitFor
                })
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
            consoleStyler.log('error', `Firecrawl Scrape Failed: ${error.message}`);
            return `Error scraping ${url}: ${error.message}`;
        }
    }

    async firecrawlCrawl(args) {
        await this.ensureApiKey();
        const { url, limit = 10, scrapeOptions = {} } = args;

        consoleStyler.log('working', `Firecrawl Crawl: ${url} (limit: ${limit})`);

        try {
            const response = await fetch(`${this.baseUrl}/crawl`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    url,
                    limit,
                    scrapeOptions
                })
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
            consoleStyler.log('error', `Firecrawl Crawl Failed: ${error.message}`);
            return `Error starting crawl for ${url}: ${error.message}`;
        }
    }

    async firecrawlCheckJob(args) {
        await this.ensureApiKey();
        const { jobId } = args;

        try {
            const response = await fetch(`${this.baseUrl}/crawl/${jobId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Firecrawl API Error: ${response.status} ${response.statusText} - ${error}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                return `Job status check failed: ${data.error || 'Unknown error'}`;
            }

            const status = data.status || data.data?.status; // Handle potential API variations
            const completed = data.completed || data.data?.completed || 0;
            const total = data.total || data.data?.total || 0;
            const creditsUsed = data.creditsUsed || data.data?.creditsUsed || 0;
            const expiresAt = data.expiresAt || data.data?.expiresAt;

            let result = `Job ID: ${jobId}\nStatus: ${status}\nProgress: ${completed}/${total}\nCredits Used: ${creditsUsed}\nExpires: ${expiresAt}`;

            if (status === 'completed' && data.data) {
                const items = data.data.map(item => `- ${item.metadata?.title || item.url || 'No Title'} (${item.url})`).join('\n');
                result += `\n\nResults:\n${items}\n\n(Full data is too large to display, but is available in context)`;
                // In a real scenario, we might want to save this to a file
            }

            return result;

        } catch (error) {
            consoleStyler.log('error', `Firecrawl Job Check Failed: ${error.message}`);
            return `Error checking job ${jobId}: ${error.message}`;
        }
    }
}
