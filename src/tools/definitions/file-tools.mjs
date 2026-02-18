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
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description: "Apply surgical search/replace edits to an existing file. More precise than write_file for small changes. Each edit finds the EXACT search text and replaces it.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Relative path to the file to edit"
                    },
                    edits: {
                        type: "array",
                        description: "Array of search/replace pairs to apply in order",
                        items: {
                            type: "object",
                            properties: {
                                search: {
                                    type: "string",
                                    description: "Exact text to find in the file"
                                },
                                replace: {
                                    type: "string",
                                    description: "Text to replace the found text with"
                                }
                            },
                            required: ["search", "replace"]
                        }
                    }
                },
                required: ["path", "edits"]
            }
        }
    }
];
