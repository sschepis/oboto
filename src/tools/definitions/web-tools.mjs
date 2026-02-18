export const WEB_TOOLS = [
    {
        type: "function",
        function: {
            name: "search_web",
            description: "Searches the web using Serper.dev API to find current information, news, or answer questions that require up-to-date data. Provides comprehensive search results with snippets and links.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query to find information on the web"
                    },
                    type: {
                        type: "string",
                        enum: ["search", "news", "images", "videos", "places", "shopping"],
                        description: "Type of search to perform",
                        default: "search"
                    },
                    num: {
                        type: "number",
                        description: "Number of results to return (1-100)",
                        minimum: 1,
                        maximum: 100,
                        default: 10
                    },
                    location: {
                        type: "string",
                        description: "Geographic location for localized results (e.g., 'New York, NY, USA')"
                    },
                    lang: {
                        type: "string",
                        description: "Language code for results (e.g., 'en', 'es', 'fr')",
                        default: "en"
                    },
                    safe: {
                        type: "string",
                        enum: ["active", "off"],
                        description: "Safe search setting",
                        default: "active"
                    }
                },
                required: ["query"]
            }
        }
    }
];
