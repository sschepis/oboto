export const BROWSER_TOOLS = [
    {
        type: "function",
        function: {
            name: "browse_open",
            description: "Opens a URL in the internal headless browser and returns a screenshot and console logs.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The URL to navigate to (e.g., http://localhost:3000). Defaults to about:blank.",
                        default: "about:blank"
                    },
                    width: {
                        type: "number",
                        description: "Viewport width (default: 1280)",
                        default: 1280
                    },
                    height: {
                        type: "number",
                        description: "Viewport height (default: 800)",
                        default: 800
                    },
                    wait_condition: {
                        type: "string",
                        enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
                        description: "When to consider navigation finished (default: networkidle0)",
                        default: "networkidle0"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browse_act",
            description: "Interacts with the current page (click, type, etc.) and returns updated state.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["click", "type", "scroll", "wait", "hover", "enter"],
                        description: "Action to perform"
                    },
                    selector: {
                        type: "string",
                        description: "CSS selector of the element to interact with (required for click/type/hover)"
                    },
                    value: {
                        type: "string",
                        description: "Value to type (for 'type' action) or amount to scroll (for 'scroll')"
                    },
                    wait_time: {
                        type: "number",
                        description: "Time to wait in ms (for 'wait' action)"
                    },
                    wait_for_navigation: {
                        type: "boolean",
                        description: "Wait for page navigation after action (default: false)",
                        default: false
                    }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browse_screenshot",
            description: "Takes a screenshot of the current page state.",
            parameters: {
                type: "object",
                properties: {
                    full_page: {
                        type: "boolean",
                        description: "Capture full scrollable page (default: false)",
                        default: false
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browse_close",
            description: "Closes the browser session.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    }
];
