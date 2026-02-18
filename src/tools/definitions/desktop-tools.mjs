export const DESKTOP_TOOLS = [
    {
        type: "function",
        function: {
            name: "mouse_move",
            description: "Moves the mouse cursor to specific screen coordinates.",
            parameters: {
                type: "object",
                properties: {
                    x: {
                        type: "number",
                        description: "X coordinate (pixels)"
                    },
                    y: {
                        type: "number",
                        description: "Y coordinate (pixels)"
                    },
                    speed: {
                        type: "number",
                        description: "Movement speed (pixels/sec). Default: 1000",
                        default: 1000
                    }
                },
                required: ["x", "y"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "mouse_click",
            description: "Clicks a mouse button at the current cursor location.",
            parameters: {
                type: "object",
                properties: {
                    button: {
                        type: "string",
                        enum: ["left", "right", "middle"],
                        description: "Button to click. Default: left",
                        default: "left"
                    },
                    double_click: {
                        type: "boolean",
                        description: "Whether to perform a double-click. Default: false",
                        default: false
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "keyboard_type",
            description: "Types text using the keyboard.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "Text string to type"
                    },
                    delay: {
                        type: "number",
                        description: "Delay between keystrokes (ms). Default: 0",
                        default: 0
                    }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "keyboard_press",
            description: "Presses and releases specific keys (e.g., 'enter', 'control', 'c'). Use for shortcuts.",
            parameters: {
                type: "object",
                properties: {
                    keys: {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        description: "Array of key names to press simultaneously"
                    }
                },
                required: ["keys"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "screen_capture",
            description: "Captures a screenshot of the entire desktop.",
            parameters: {
                type: "object",
                properties: {
                    filename: {
                        type: "string",
                        description: "Output filename (e.g., 'screenshot.png'). Default: 'screenshot.png'",
                        default: "screenshot.png"
                    }
                }
            }
        }
    }
];
