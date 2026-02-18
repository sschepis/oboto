export const CHROME_EXT_TOOLS = [
    // Tab Management
    {
        type: "function",
        function: {
            name: "chrome_list_tabs",
            description: "List all open browser tabs with their URLs, titles, and IDs",
            parameters: {
                type: "object",
                properties: {
                    windowId: { type: "number", description: "Filter by window ID (optional)" },
                    active: { type: "boolean", description: "Filter active tabs only" },
                    url: { type: "string", description: "URL pattern to match" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_create_tab",
            description: "Open a new browser tab",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL to open" },
                    active: { type: "boolean", description: "Whether to make the tab active", default: true },
                    windowId: { type: "number", description: "Window to open in" }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_close_tab",
            description: "Close one or more browser tabs",
            parameters: {
                type: "object",
                properties: {
                    tabIds: {
                        oneOf: [
                            { type: "number" },
                            { type: "array", items: { type: "number" } }
                        ],
                        description: "Tab ID or array of tab IDs to close"
                    }
                },
                required: ["tabIds"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_navigate",
            description: "Navigate a tab to a URL",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID to navigate (omit for active tab)" },
                    url: { type: "string", description: "URL to navigate to" },
                    waitForLoad: { type: "boolean", description: "Wait for page load to complete", default: true }
                },
                required: ["url"]
            }
        }
    },
    // Window Management
    {
        type: "function",
        function: {
            name: "chrome_list_windows",
            description: "List all open browser windows",
            parameters: { type: "object", properties: {} }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_create_window",
            description: "Open a new browser window",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL to open in the new window" },
                    type: { type: "string", enum: ["normal", "popup", "panel"], default: "normal" },
                    width: { type: "number" },
                    height: { type: "number" },
                    left: { type: "number" },
                    top: { type: "number" },
                    incognito: { type: "boolean", default: false }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_close_window",
            description: "Close a browser window",
            parameters: {
                type: "object",
                properties: {
                    windowId: { type: "number", description: "Window ID to close" }
                },
                required: ["windowId"]
            }
        }
    },
    // DOM Interaction
    {
        type: "function",
        function: {
            name: "chrome_click",
            description: "Click an element on the page",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    selector: { type: "string", description: "CSS selector of element to click" }
                },
                required: ["selector"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_type",
            description: "Type text into an input element",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    selector: { type: "string", description: "CSS selector of input element" },
                    text: { type: "string", description: "Text to type" },
                    clearFirst: { type: "boolean", description: "Clear existing value before typing", default: false }
                },
                required: ["selector", "text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_evaluate",
            description: "Execute JavaScript in a tab's page context and return the result",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    expression: { type: "string", description: "JavaScript expression to evaluate" },
                    awaitPromise: { type: "boolean", description: "If expression returns a Promise, await it", default: false }
                },
                required: ["expression"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_screenshot",
            description: "Take a screenshot of a tab's visible area",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    format: { type: "string", enum: ["png", "jpeg"], default: "jpeg" },
                    quality: { type: "number", description: "JPEG quality 0-100", default: 80 }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_get_page_info",
            description: "Get comprehensive information about the current page: title, URL, meta tags, headings, links, forms, and visible text summary",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    includeLinks: { type: "boolean", default: true },
                    includeForms: { type: "boolean", default: true },
                    includeHeadings: { type: "boolean", default: true },
                    maxTextLength: { type: "number", description: "Max chars of visible text to return", default: 5000 }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_query_dom",
            description: "Query the DOM using CSS selectors and return matching elements with their attributes, text, and positions",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    selector: { type: "string", description: "CSS selector" },
                    limit: { type: "number", description: "Max number of elements to return", default: 20 }
                },
                required: ["selector"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_fill_form",
            description: "Fill multiple form fields at once",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    fields: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                selector: { type: "string" },
                                value: { type: "string" }
                            },
                            required: ["selector", "value"]
                        },
                        description: "Array of selector/value pairs to fill"
                    },
                    submit: { type: "boolean", description: "Submit the form after filling", default: false }
                },
                required: ["fields"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_scroll",
            description: "Scroll the page or an element",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    direction: { type: "string", enum: ["up", "down", "top", "bottom"], default: "down" },
                    amount: { type: "number", description: "Pixels to scroll (for up/down)", default: 500 },
                    selector: { type: "string", description: "CSS selector of scrollable element (omit for page)" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_wait_for",
            description: "Wait for a condition on the page: element to appear, URL to match, or text to be present",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    selector: { type: "string", description: "CSS selector to wait for" },
                    text: { type: "string", description: "Text content to wait for" },
                    url: { type: "string", description: "URL pattern to wait for" },
                    timeout: { type: "number", description: "Max wait time in ms", default: 10000 }
                }
            }
        }
    },
    // Advanced: CDP direct access
    {
        type: "function",
        function: {
            name: "chrome_cdp_command",
            description: "Send a raw Chrome DevTools Protocol command. For advanced automation: network interception, performance profiling, DOM snapshotting, etc.",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    method: { type: "string", description: "CDP method (e.g. 'Network.enable', 'Page.captureScreenshot')" },
                    params: { type: "object", description: "CDP command parameters" }
                },
                required: ["method"]
            }
        }
    },
    // Utility
    {
        type: "function",
        function: {
            name: "chrome_extract_content",
            description: "Extract structured content from the current page: article text, tables, lists, images, or all structured data",
            parameters: {
                type: "object",
                properties: {
                    tabId: { type: "number", description: "Tab ID (omit for active tab)" },
                    type: { type: "string", enum: ["text", "tables", "links", "images", "forms", "all"], default: "all" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "chrome_cookies_manage",
            description: "Get, set, or delete cookies",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["get", "set", "delete"] },
                    url: { type: "string", description: "URL associated with the cookie" },
                    name: { type: "string", description: "Cookie name" },
                    value: { type: "string", description: "Cookie value (for set)" },
                    domain: { type: "string", description: "Cookie domain" }
                },
                required: ["action", "url"]
            }
        }
    }
];
