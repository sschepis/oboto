export const FIRECRAWL_TOOLS = [
    {
        type: "function",
        function: {
            name: "firecrawl_scrape",
            description: "Scrape a single URL using Firecrawl. Returns clean markdown, HTML, or other formats. Best for reading a specific page.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The URL to scrape"
                    },
                    formats: {
                        type: "array",
                        items: {
                            type: "string",
                            enum: ["markdown", "html", "rawHtml", "links", "screenshot"]
                        },
                        description: "Formats to return. Default is ['markdown'].",
                        default: ["markdown"]
                    },
                    onlyMainContent: {
                        type: "boolean",
                        description: "If true, excludes header/footer/nav. Default true.",
                        default: true
                    },
                    waitFor: {
                        type: "number",
                        description: "Time to wait in ms before scraping (for dynamic content). Default 0."
                    }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "firecrawl_crawl",
            description: "Crawl a website starting from a URL using Firecrawl. Returns a job ID to check status or the results if fast. Best for mapping a site.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The base URL to start crawling"
                    },
                    limit: {
                        type: "number",
                        description: "Maximum number of pages to crawl. Default 10.",
                        default: 10
                    },
                    scrapeOptions: {
                        type: "object",
                        description: "Options for scraping each page (formats, onlyMainContent, etc.)"
                    }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "firecrawl_check_job",
            description: "Check the status of a Firecrawl crawl job.",
            parameters: {
                type: "object",
                properties: {
                    jobId: {
                        type: "string",
                        description: "The Job ID returned by firecrawl_crawl"
                    }
                },
                required: ["jobId"]
            }
        }
    }
];
