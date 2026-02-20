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
    },
    {
        type: "function",
        function: {
            name: "read_many_files",
            description: "Read multiple files in a single call. Safe: enforces per-file (128KB) and total (512KB) size caps, skips binary files, and truncates oversized content. Returns a JSON object with a summary and per-file results.",
            parameters: {
                type: "object",
                properties: {
                    paths: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of relative file paths to read (max 50)"
                    },
                    max_total_bytes: {
                        type: "number",
                        description: "Maximum total bytes across all files (default: 524288 = 512KB)"
                    },
                    max_per_file_bytes: {
                        type: "number",
                        description: "Maximum bytes per individual file (default: 131072 = 128KB)"
                    },
                    encoding: {
                        type: "string",
                        description: "File encoding (default: utf8)"
                    }
                },
                required: ["paths"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_many_files",
            description: "Write multiple files in a single call. Supports mixed encodings, auto-creates directories, and returns per-file success/failure results. Use dry_run to preview without writing.",
            parameters: {
                type: "object",
                properties: {
                    files: {
                        type: "array",
                        description: "Array of file objects to write (max 30)",
                        items: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: "Relative path to the file"
                                },
                                content: {
                                    type: "string",
                                    description: "Content to write"
                                },
                                encoding: {
                                    type: "string",
                                    description: "File encoding (default: utf8)"
                                }
                            },
                            required: ["path", "content"]
                        }
                    },
                    create_dirs: {
                        type: "boolean",
                        description: "Automatically create parent directories (default: true)"
                    },
                    dry_run: {
                        type: "boolean",
                        description: "If true, reports what would be written without actually writing (default: false)"
                    }
                },
                required: ["files"]
            }
        }
    }
];
