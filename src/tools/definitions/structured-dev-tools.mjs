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
    },
    {
        type: "function",
        function: {
            name: "generate_c4_diagram",
            description: "Generates a C4 Component diagram (Mermaid JS) based on the current SYSTEM_MAP.md. Visualizes features and their dependencies.",
            parameters: {
                type: "object",
                properties: {
                    level: {
                        type: "string",
                        enum: ["component"],
                        description: "The level of detail for the diagram. Currently only 'component' is supported.",
                        default: "component"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "build_knowledge_graph",
            description: "Scans the codebase to build a knowledge graph of files, classes, and dependencies. Returns a JSON representation of nodes and edges.",
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
            name: "generate_cicd_pipeline",
            description: "Generates a CI/CD pipeline configuration (e.g., GitHub Actions, GitLab CI) by analyzing the project structure and dependencies.",
            parameters: {
                type: "object",
                properties: {
                    platform: {
                        type: "string",
                        enum: ["github", "gitlab"],
                        description: "The target CI/CD platform. Default: github",
                        default: "github"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_docker_config",
            description: "Generates Dockerfile, .dockerignore, and docker-compose.yml based on the project analysis.",
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
            name: "generate_api_docs",
            description: "Generates Markdown API documentation by scanning source files for JSDoc comments.",
            parameters: {
                type: "object",
                properties: {
                    target_dir: {
                        type: "string",
                        description: "The directory to scan for source files. Default: src",
                        default: "src"
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_tutorial",
            description: "Generates a markdown tutorial based on the current session history.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description: "The title of the tutorial."
                    }
                },
                required: ["title"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_enhancements",
            description: "Analyzes the codebase to suggest a list of improvements (performance, security, features, refactoring).",
            parameters: {
                type: "object",
                properties: {
                    category: {
                        type: "string",
                        description: "Filter by category (e.g., 'performance', 'security', 'refactoring', 'feature', 'all'). Default: 'all'.",
                        default: "all"
                    },
                    focus_dirs: {
                        type: "array",
                        description: "Optional list of directories to focus the analysis on.",
                        items: {
                            type: "string"
                        }
                    }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "implement_enhancements",
            description: "Implements a list of enhancements using AI agents. Takes a list of enhancement objects.",
            parameters: {
                type: "object",
                properties: {
                    enhancements: {
                        type: "array",
                        description: "List of enhancement objects to implement. Each object should have 'title' and 'description'.",
                        items: {
                            type: "object",
                            properties: {
                                id: {
                                    type: "string"
                                },
                                title: {
                                    type: "string"
                                },
                                description: {
                                    type: "string"
                                },
                                type: {
                                    type: "string"
                                },
                                priority: {
                                    type: "string"
                                },
                                affected_files: {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    }
                                }
                            },
                            required: ["title", "description"]
                        }
                    }
                },
                required: ["enhancements"]
            }
        }
    }
];
