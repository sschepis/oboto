// Tool definitions for the AI assistant
// This module contains all the built-in tool schemas used by the AI

export const CORE_TOOLS = [
    {
        type: "function",
        function: {
            name: "execute_javascript",
            description: "Executes a string of JavaScript code using eval(). Use this for simple calculations or for writing complex scripts that compose multiple functions or packages. You can specify dependent npm packages that must be installed. Optionally save useful code as a reusable tool.",
            parameters: {
                type: "object",
                properties: {
                    code: {
                        type: "string",
                        description: "The JavaScript code to execute. Must be an async IIFE (Immediately Invoked Function Expression) if it uses imports, e.g., (async () => { const axios = await import('axios'); /* ... */ })();",
                    },
                    npm_packages: {
                        type: "array",
                        description: "An optional array of npm package names that need to be installed before the script is run (e.g., ['axios', 'chalk']).",
                        items: {
                            type: "string"
                        }
                    },
                    save_as_tool: {
                        type: "boolean",
                        description: "Whether to save this code as a reusable tool for future use.",
                        default: false
                    },
                    tool_name: {
                        type: "string",
                        description: "Name for the tool (snake_case, e.g. 'get_weather'). Required if save_as_tool is true."
                    },
                    tool_description: {
                        type: "string",
                        description: "Description of what this tool does. Required if save_as_tool is true."
                    },
                    tool_category: {
                        type: "string",
                        description: "Category for the tool (e.g. 'file', 'web', 'data', 'utility'). Optional.",
                        default: "utility"
                    }
                },
                required: ["code"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "execute_npm_function",
            description: "Dynamically installs an npm package if needed, imports it, and executes a specific function from it with given arguments. Use this for single, specific package functions.",
            parameters: {
                type: "object",
                properties: {
                    packageName: {
                        type: "string",
                        description: "The name of the npm package to use (e.g., 'axios', 'uuid').",
                    },
                    functionName: {
                        type: "string",
                        description: "The name of the function to call from the package (e.g., 'get', 'v4'). If the package itself is a function, use 'default'.",
                    },
                    args: {
                        type: "array",
                        description: "An array of arguments to pass to the function.",
                        items: {
                            type: "any"
                        }
                    }
                },
                required: ["packageName", "functionName", "args"],
            },
        },
    }
];

export const WORKFLOW_TOOLS = [
    {
        type: "function",
        function: {
            name: "create_todo_list",
            description: "Creates a todo list for complex tasks that need to be broken down into steps. Use this when a user request requires multiple sequential actions.",
            parameters: {
                type: "object",
                properties: {
                    task_description: {
                        type: "string",
                        description: "Brief description of the overall task."
                    },
                    todos: {
                        type: "array",
                        description: "Array of todo items in execution order.",
                        items: {
                            type: "object",
                            properties: {
                                step: {
                                    type: "string",
                                    description: "Description of this step."
                                },
                                status: {
                                    type: "string",
                                    enum: ["pending", "in_progress", "completed"],
                                    description: "Status of this step."
                                }
                            },
                            required: ["step", "status"]
                        }
                    }
                },
                required: ["task_description", "todos"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "update_todo_status",
            description: "Updates the status of a todo item and moves to the next step if completed.",
            parameters: {
                type: "object",
                properties: {
                    step_index: {
                        type: "number",
                        description: "Zero-based index of the step to update."
                    },
                    status: {
                        type: "string",
                        enum: ["pending", "in_progress", "completed"],
                        description: "New status for this step."
                    },
                    result: {
                        type: "string",
                        description: "Brief result or outcome of completing this step."
                    }
                },
                required: ["step_index", "status"],
            },
        },
    }
];

export const RECOVERY_TOOLS = [
    {
        type: "function",
        function: {
            name: "analyze_and_recover",
            description: "Analyzes the last error and attempts recovery with alternative approaches.",
            parameters: {
                type: "object",
                properties: {
                    error_message: {
                        type: "string",
                        description: "The error message to analyze."
                    },
                    failed_approach: {
                        type: "string",
                        description: "Description of what was attempted that failed."
                    },
                    recovery_strategy: {
                        type: "string",
                        enum: ["retry_with_alternative", "simplify_approach", "change_method", "install_dependencies", "fix_syntax"],
                        description: "The recovery strategy to attempt."
                    },
                    alternative_code: {
                        type: "string",
                        description: "Alternative code to try if using retry_with_alternative strategy.",
                        required: false
                    }
                },
                required: ["error_message", "failed_approach", "recovery_strategy"],
            },
        },
    }
];

export const ENHANCEMENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "embellish_request",
            description: "Takes a user's high-level request and rewrites it with specific technical implementation details, tools, and methodologies needed to accomplish the task. Also predicts the appropriate reasoning effort level.",
            parameters: {
                type: "object",
                properties: {
                    original_request: {
                        type: "string",
                        description: "The user's original request."
                    },
                    embellished_request: {
                        type: "string",
                        description: "Detailed technical rewrite specifying exact tools, methods, libraries, file formats, data structures, and step-by-step approach needed."
                    },
                    technical_requirements: {
                        type: "array",
                        description: "List of specific technical requirements identified.",
                        items: {
                            type: "string"
                        }
                    },
                    reasoning_effort: {
                        type: "string",
                        enum: ["low", "medium", "high"],
                        description: "Predicted reasoning effort needed based on: 'low' for simple/quick tasks, 'medium' for standard implementation, 'high' for complex analysis/debugging. Respect user preferences like 'quickly' (low) or 'thoroughly' (high)."
                    },
                    reasoning_justification: {
                        type: "string",
                        description: "Brief explanation of why this reasoning level was chosen, considering task complexity and user preferences."
                    }
                },
                required: ["original_request", "embellished_request", "technical_requirements", "reasoning_effort", "reasoning_justification"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "evaluate_response_quality",
            description: "Evaluates whether the AI's response appropriately addresses the user's original query and resembles what a typical, helpful response should look like.",
            parameters: {
                type: "object",
                properties: {
                    original_query: {
                        type: "string",
                        description: "The user's original request/question."
                    },
                    ai_response: {
                        type: "string",
                        description: "The AI's generated response to evaluate."
                    },
                    quality_rating: {
                        type: "number",
                        minimum: 1,
                        maximum: 10,
                        description: "Quality rating from 1-10 where 10 = perfect response that fully addresses the query, 1 = completely inappropriate/unhelpful response."
                    },
                    evaluation_reasoning: {
                        type: "string",
                        description: "Brief explanation of why this rating was given."
                    },
                    remedy_suggestion: {
                        type: "string",
                        description: "If rating < 4, specific suggestion on how to improve the response or what should be done differently."
                    }
                },
                required: ["original_query", "ai_response", "quality_rating", "evaluation_reasoning"],
            },
        },
    }
];

export const TTS_TOOLS = [
    {
        type: "function",
        function: {
            name: "speak_text",
            description: "Converts text to speech using ElevenLabs and plays it aloud. Use this when the user asks to hear the response spoken or wants text-to-speech.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "The text to convert to speech. Should be clean text without markdown formatting."
                    },
                    voice_id: {
                        type: "string",
                        description: "ElevenLabs voice ID to use. Default is 'tQ4MEZFJOzsahSEEZtHK'.",
                        default: "tQ4MEZFJOzsahSEEZtHK"
                    },
                    stability: {
                        type: "number",
                        description: "Voice stability (0.0-1.0). Higher values = more stable. Default: 0.5",
                        minimum: 0.0,
                        maximum: 1.0,
                        default: 0.5
                    },
                    similarity_boost: {
                        type: "number",
                        description: "Similarity boost (0.0-1.0). Higher values = more similar to original voice. Default: 0.75",
                        minimum: 0.0,
                        maximum: 1.0,
                        default: 0.75
                    }
                },
                required: ["text"],
            },
        },
    }
];

export const CUSTOM_TOOL_MANAGEMENT = [
    {
        type: "function",
        function: {
            name: "list_custom_tools",
            description: "List all custom tools that have been created and saved, with optional filtering by category",
            parameters: {
                type: "object",
                properties: {
                    category: {
                        type: "string",
                        description: "Filter tools by category (optional)"
                    },
                    show_usage: {
                        type: "boolean",
                        description: "Include usage statistics in the output",
                        default: false
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "remove_custom_tool",
            description: "Remove a custom tool from the toolbox permanently",
            parameters: {
                type: "object",
                properties: {
                    tool_name: {
                        type: "string",
                        description: "Name of the tool to remove"
                    }
                },
                required: ["tool_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "export_tools",
            description: "Export custom tools to a shareable JSON file",
            parameters: {
                type: "object",
                properties: {
                    output_file: {
                        type: "string",
                        description: "Path where to save the exported tools file"
                    },
                    tools: {
                        type: "array",
                        description: "Specific tools to export (exports all if not specified)",
                        items: { type: "string" }
                    }
                }
            }
        }
    }
];

export const WORKSPACE_TOOLS = [
    {
        type: "function",
        function: {
            name: "manage_workspace",
            description: "Create, update, or clear persistent workspace data for complex multi-step tasks. Use this to maintain context across retries and quality evaluations.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "update", "clear", "show"],
                        description: "Action to perform: create new workspace, update existing, clear workspace, or show current workspace"
                    },
                    task_goal: {
                        type: "string",
                        description: "The main goal/objective of the current task (required for 'create')"
                    },
                    current_step: {
                        type: "string",
                        description: "Description of the current step being worked on"
                    },
                    progress_data: {
                        type: "object",
                        description: "Data collected so far (files found, analysis results, etc.)"
                    },
                    next_steps: {
                        type: "array",
                        description: "Planned next steps",
                        items: { type: "string" }
                    },
                    status: {
                        type: "string",
                        enum: ["in_progress", "completed", "failed"],
                        description: "Current status of the task"
                    }
                },
                required: ["action"]
            }
        }
    }
];

export const STRUCTURED_DEV_TOOLS = [
    {
        type: "function",
        function: {
            name: "init_structured_dev",
            description: "Initializes the Structured Development process by creating a SYSTEM_MAP.md manifest. If a DESIGN.md or ARCHITECTURE.md exists in the target directory, it will pre-populate the manifest with extracted features and constraints.",
            parameters: {
                type: "object",
                properties: {
                    target_dir: {
                        type: "string",
                        description: "Optional target directory to initialize in. Defaults to current working directory. If a design document exists here, features and invariants will be extracted automatically."
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "bootstrap_project",
            description: "Initializes structured development in a target directory by discovering and parsing a design document (DESIGN.md, ARCHITECTURE.md, or README.md). Extracts features, invariants, and constraints to pre-populate the SYSTEM_MAP.md manifest, effectively pre-loading the structured development process with the provided design.",
            parameters: {
                type: "object",
                properties: {
                    target_dir: {
                        type: "string",
                        description: "Path to the project directory to bootstrap. Defaults to current working directory."
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "submit_technical_design",
            description: "Submits a technical design document. This transitions the feature to the 'Design Review' phase.",
            parameters: {
                type: "object",
                properties: {
                    feature_id: {
                        type: "string",
                        description: "ID of the feature being designed (e.g., FEAT-001)"
                    },
                    design_doc: {
                        type: "string",
                        description: "The comprehensive technical design document content"
                    }
                },
                required: ["feature_id", "design_doc"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "approve_design",
            description: "Approves a feature's design, moving it from 'Design Review' to 'Interface' phase. This step confirms that the user is satisfied with the proposed design.",
            parameters: {
                type: "object",
                properties: {
                    feature_id: {
                        type: "string",
                        description: "ID of the feature to approve"
                    },
                    feedback: {
                        type: "string",
                        description: "Optional feedback or notes about the approval"
                    }
                },
                required: ["feature_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "lock_interfaces",
            description: "Locks the API signatures and type definitions (Phase II). Validates that all interfaces have JSDoc documentation. Once locked, these cannot be changed without a formal refactor process.",
            parameters: {
                type: "object",
                properties: {
                    feature_id: {
                        type: "string",
                        description: "ID of the feature"
                    },
                    interface_definitions: {
                        type: "string",
                        description: "The type definitions (e.g., contents of a .d.ts file). Must include JSDoc comments."
                    }
                },
                required: ["feature_id", "interface_definitions"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "submit_critique",
            description: "Submits a mandatory self-critique (Phase III) identifying at least 3 flaws before final implementation.",
            parameters: {
                type: "object",
                properties: {
                    feature_id: {
                        type: "string",
                        description: "ID of the feature"
                    },
                    critique: {
                        type: "string",
                        description: "The critique identifying at least 3 potential flaws"
                    }
                },
                required: ["feature_id", "critique"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_manifest",
            description: "Reads the current SYSTEM_MAP.md manifest to understand global invariants, feature status, and dependency graph.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_implementation_plan",
            description: "Analyzes the SYSTEM_MAP.md to generate a parallel execution plan based on feature dependencies. Outputs a JSON plan file.",
            parameters: {
                type: "object",
                properties: {
                    output_file: {
                        type: "string",
                        description: "Path to save the plan JSON file (default: implementation-plan.json)"
                    },
                    num_developers: {
                        type: "number",
                        description: "Number of concurrent developers/agents to schedule for (default: 3).",
                        default: 3
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "execute_implementation_plan",
            description: "Executes a multi-agent implementation plan. Spawns concurrent AI agents to implement features in parallel according to the plan.",
            parameters: {
                type: "object",
                properties: {
                    plan_file: {
                        type: "string",
                        description: "Path to the plan JSON file to execute (default: implementation-plan.json)"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "visualize_architecture",
            description: "Generates a Mermaid JS Flowchart syntax representing the system's architecture and dependencies based on the manifest.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "rollback_to_snapshot",
            description: "Restores the system manifest (SYSTEM_MAP.md) to a previous state from a snapshot.",
            parameters: {
                type: "object",
                properties: {
                    snapshot_id: {
                        type: "string",
                        description: "The filename or partial identifier of the snapshot to restore (e.g. 'SYSTEM_MAP.2023-10-27T10-00-00-000Z.md' or just the timestamp part)"
                    }
                },
                required: ["snapshot_id"]
            }
        }
    }
];

export const RECURSIVE_TOOLS = [
    {
        type: "function",
        function: {
            name: "call_ai_assistant",
            description: "Recursively calls the AI assistant to handle a sub-task or specialized query. Useful for breaking down complex problems or getting specialized analysis. Maximum recursion depth is 3 levels.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The specific query or task to send to the recursive AI assistant"
                    },
                    context: {
                        type: "string",
                        description: "Additional context about why this recursive call is needed and how it relates to the main task"
                    },
                    recursion_level: {
                        type: "number",
                        description: "Current recursion level (automatically managed, do not set manually)",
                        default: 0
                    }
                },
                required: ["query", "context"]
            }
        }
    }
];

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

export const FILE_TOOLS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Reads content from a file within the workspace.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the file to read"
                    },
                    encoding: {
                        type: "string",
                        description: "File encoding (default: utf8)",
                        default: "utf8"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Writes content to a file within the workspace. Creates directories if needed.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the file to write"
                    },
                    content: {
                        type: "string",
                        description: "Content to write to the file"
                    },
                    encoding: {
                        type: "string",
                        description: "File encoding (default: utf8)",
                        default: "utf8"
                    }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_files",
            description: "Lists files and directories in a specified path within the workspace.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to list (default: root)",
                        default: "."
                    },
                    recursive: {
                        type: "boolean",
                        description: "Whether to list recursively",
                        default: false
                    }
                },
                required: ["path"]
            }
        }
    }
];

// Combine all tools into the main TOOLS array
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

export const TOOLS = [
    ...CORE_TOOLS,
    ...WORKFLOW_TOOLS,
    ...RECOVERY_TOOLS,
    ...ENHANCEMENT_TOOLS,
    ...TTS_TOOLS,
    ...CUSTOM_TOOL_MANAGEMENT,
    ...WORKSPACE_TOOLS,
    ...STRUCTURED_DEV_TOOLS,
    ...RECURSIVE_TOOLS,
    ...WEB_TOOLS,
    ...FILE_TOOLS,
    ...DESKTOP_TOOLS
];