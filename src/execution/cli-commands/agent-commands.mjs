/**
 * CLI Agent Commands — Unix-style wrappers for agent capabilities
 *
 * Commands: memory, skill, task, surface
 * These wrap existing ToolExecutor handlers with a CLI-friendly interface.
 *
 * Design: These commands use the ToolExecutor's handler registry to invoke
 * the underlying typed tool, converting CLI args to the expected parameter
 * objects. This avoids duplicating logic while providing the CLI shortcut.
 */

/**
 * Create agent commands bound to a ToolExecutor instance.
 * @param {import('../tool-executor.mjs').ToolExecutor} toolExecutor
 * @returns {Object} command registry
 */
export function createAgentCommands(toolExecutor) {
    return {
        memory: {
            help: 'Search or manage memory. Usage: memory search|store|query|promote',
            usage: 'memory search|store|query|promote',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'memory: usage: memory <subcommand> [args]\n' +
                            '  Subcommands:\n' +
                            '    memory search <query>         — search conversation memory\n' +
                            '    memory query <query> [-l N]   — query global memory\n' +
                            '    memory promote <text>         — promote text to global memory\n' +
                            '    memory history [-n N]         — read conversation history',
                        exitCode: 1,
                    };
                }

                const subcommand = args[0];
                const subArgs = args.slice(1);

                switch (subcommand) {
                    case 'search':
                    case 'query': {
                        const query = subArgs.filter(a => !a.startsWith('-')).join(' ');
                        if (!query) {
                            return { output: 'memory query: usage: memory query <query> [-l limit]', exitCode: 1 };
                        }
                        const limitIdx = subArgs.indexOf('-l');
                        const limit = limitIdx >= 0 ? parseInt(subArgs[limitIdx + 1], 10) : 5;
                        return await invokeHandler(toolExecutor, 'query_global_memory', { query, limit });
                    }
                    case 'promote': {
                        const text = subArgs.join(' ') || stdin;
                        if (!text) {
                            return { output: 'memory promote: usage: memory promote <text>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'promote_memory', { text });
                    }
                    case 'history': {
                        const nIdx = subArgs.indexOf('-n');
                        const limit = nIdx >= 0 ? parseInt(subArgs[nIdx + 1], 10) : 10;
                        return await invokeHandler(toolExecutor, 'read_conversation_history', { limit });
                    }
                    default:
                        return {
                            output: `[error] memory: unknown subcommand "${subcommand}". Available: search, query, promote, history`,
                            exitCode: 1,
                        };
                }
            },
        },

        skill: {
            help: 'List, read, or use skills. Usage: skill list|read|use <name>',
            usage: 'skill list|read|use <name>',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'skill: usage: skill <subcommand> [args]\n' +
                            '  Subcommands:\n' +
                            '    skill list                    — list available skills\n' +
                            '    skill read <name>             — read skill documentation\n' +
                            '    skill use <name> [args...]    — execute a skill\n' +
                            '    skill create <name> <desc>    — create a new skill\n' +
                            '    skill delete <name>           — delete a skill',
                        exitCode: 1,
                    };
                }

                const subcommand = args[0];
                const subArgs = args.slice(1);

                switch (subcommand) {
                    case 'list':
                        return await invokeHandler(toolExecutor, 'list_skills', {});
                    case 'read': {
                        const name = subArgs[0];
                        if (!name) {
                            return { output: 'skill read: usage: skill read <name>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'read_skill', { skill_name: name });
                    }
                    case 'use': {
                        const name = subArgs[0];
                        if (!name) {
                            return { output: 'skill use: usage: skill use <name> [task...]', exitCode: 1 };
                        }
                        const task = subArgs.slice(1).join(' ');
                        return await invokeHandler(toolExecutor, 'use_skill', { skill_name: name, task });
                    }
                    case 'create': {
                        const name = subArgs[0];
                        const content = subArgs.slice(1).join(' ');
                        if (!name || !content) {
                            return { output: 'skill create: usage: skill create <name> <content>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'create_skill', { name, content });
                    }
                    case 'delete': {
                        const name = subArgs[0];
                        if (!name) {
                            return { output: 'skill delete: usage: skill delete <name>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'delete_skill', { name });
                    }
                    default:
                        return {
                            output: `[error] skill: unknown subcommand "${subcommand}". Available: list, read, use, create, delete`,
                            exitCode: 1,
                        };
                }
            },
        },

        task: {
            help: 'Manage background tasks. Usage: task spawn|list|status|cancel',
            usage: 'task spawn|list|status|cancel <id>',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'task: usage: task <subcommand> [args]\n' +
                            '  Subcommands:\n' +
                            '    task spawn <goal>             — spawn a background task\n' +
                            '    task list                     — list all background tasks\n' +
                            '    task status <id>              — check task status\n' +
                            '    task cancel <id>              — cancel a running task\n' +
                            '    task output <id>              — get task output\n' +
                            '    task wait <id>                — wait for task completion',
                        exitCode: 1,
                    };
                }

                const subcommand = args[0];
                const subArgs = args.slice(1);

                switch (subcommand) {
                    case 'spawn': {
                        const goal = subArgs.join(' ');
                        if (!goal) {
                            return { output: 'task spawn: usage: task spawn <goal description>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'spawn_background_task', { task_description: goal, query: goal });
                    }
                    case 'list':
                        return await invokeHandler(toolExecutor, 'list_background_tasks', {});
                    case 'status': {
                        const taskId = subArgs[0];
                        if (!taskId) {
                            return { output: 'task status: usage: task status <task_id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'check_task_status', { task_id: taskId });
                    }
                    case 'cancel': {
                        const taskId = subArgs[0];
                        if (!taskId) {
                            return { output: 'task cancel: usage: task cancel <task_id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'cancel_background_task', { task_id: taskId });
                    }
                    case 'output': {
                        const taskId = subArgs[0];
                        if (!taskId) {
                            return { output: 'task output: usage: task output <task_id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'get_task_output', { task_id: taskId });
                    }
                    case 'wait': {
                        const taskId = subArgs[0];
                        if (!taskId) {
                            return { output: 'task wait: usage: task wait <task_id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'wait_for_task', { task_id: taskId });
                    }
                    default:
                        return {
                            output: `[error] task: unknown subcommand "${subcommand}". Available: spawn, list, status, cancel, output, wait`,
                            exitCode: 1,
                        };
                }
            },
        },

        surface: {
            help: 'Create and manage UI surfaces. Usage: surface create|list|open|delete|revisions|revert',
            usage: 'surface create|list|open|delete|revisions|revert',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'surface: usage: surface <subcommand> [args]\n' +
                            '  Subcommands:\n' +
                            '    surface list                  — list all surfaces\n' +
                            '    surface create <name>         — create a new surface\n' +
                            '    surface open <id>             — open a surface in browser\n' +
                            '    surface delete <id>           — delete a surface\n' +
                            '    surface revisions <id>        — list revision history\n' +
                            '    surface revert <id> <rev>     — revert to a revision',
                        exitCode: 1,
                    };
                }

                const subcommand = args[0];
                const subArgs = args.slice(1);

                switch (subcommand) {
                    case 'list':
                        return await invokeHandler(toolExecutor, 'list_surfaces', {});
                    case 'create': {
                        const name = subArgs[0];
                        if (!name) {
                            return { output: 'surface create: usage: surface create <name>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'create_surface', { name });
                    }
                    case 'open': {
                        const name = subArgs[0];
                        if (!name) {
                            return { output: 'surface open: usage: surface open <id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'open_surface', { surface_id: name });
                    }
                    case 'delete': {
                        const name = subArgs[0];
                        if (!name) {
                            return { output: 'surface delete: usage: surface delete <id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'delete_surface', { surface_id: name });
                    }
                    case 'revisions': {
                        const id = subArgs[0];
                        if (!id) {
                            return { output: 'surface revisions: usage: surface revisions <surface_id>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'list_surface_revisions', { surface_id: id });
                    }
                    case 'revert': {
                        const id = subArgs[0];
                        const rev = subArgs[1] ? parseInt(subArgs[1], 10) : NaN;
                        if (!id || isNaN(rev)) {
                            return { output: 'surface revert: usage: surface revert <surface_id> <revision_number>', exitCode: 1 };
                        }
                        return await invokeHandler(toolExecutor, 'revert_surface', { surface_id: id, revision: rev });
                    }
                    default:
                        return {
                            output: `[error] surface: unknown subcommand "${subcommand}". Available: list, create, open, delete, revisions, revert`,
                            exitCode: 1,
                        };
                }
            },
        },

        tools: {
            help: 'List available custom tools and skills.',
            usage: 'tools [list]',
            async execute(args, stdin) {
                return await invokeHandler(toolExecutor, 'list_custom_tools', {});
            },
        },

        chimein: {
            help: 'Inject guidance or commentary into the running agent task.',
            usage: 'chimein <message>',
            async execute(args, stdin) {
                const message = args.join(' ').trim();
                if (!message) {
                    return {
                        output: 'chimein: usage: chimein <your guidance message>\n' +
                            '  Example: chimein Please also add unit tests for the new function',
                        exitCode: 1,
                    };
                }
                const facade = toolExecutor.assistant;
                if (!facade || typeof facade.queueChimeIn !== 'function') {
                    return { output: '[error] chimein: agent facade not available', exitCode: 1 };
                }
                const success = facade.queueChimeIn(message, 'cli');
                if (success) {
                    const busy = facade.isBusy();
                    const queue = facade.getGuidanceQueue();
                    const statusNote = busy
                        ? 'Will be injected at the next agent loop iteration.'
                        : 'Agent is not currently running — guidance will be applied when the next task starts.';
                    return {
                        output: `✓ Guidance queued. ${statusNote}\nQueue size: ${queue.length}`,
                        exitCode: 0,
                    };
                }
                return { output: '[error] chimein: failed to queue guidance. Message may be empty or invalid.', exitCode: 1 };
            },
        },

        guidancequeue: {
            help: 'View the current guidance injection queue.',
            usage: 'guidancequeue',
            async execute(args, stdin) {
                const facade = toolExecutor.assistant;
                if (!facade || typeof facade.getGuidanceQueue !== 'function') {
                    return { output: '[error] guidancequeue: agent facade not available', exitCode: 1 };
                }
                const queue = facade.getGuidanceQueue();
                if (queue.length === 0) {
                    return { output: 'Guidance queue is empty.', exitCode: 0 };
                }
                const lines = queue.map((entry, i) => {
                    const time = new Date(entry.timestamp).toLocaleTimeString();
                    return `  ${i + 1}. [${time}] (${entry.source}) ${entry.message}`;
                });
                return {
                    output: `Guidance queue (${queue.length} pending):\n${lines.join('\n')}`,
                    exitCode: 0,
                };
            },
        },
    };
}

/**
 * Invoke a registered handler via ToolExecutor and normalize the result.
 * @param {import('../tool-executor.mjs').ToolExecutor} toolExecutor
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{ output: string, exitCode: number }>}
 */
async function invokeHandler(toolExecutor, toolName, args) {
    try {
        const handler = toolExecutor.getToolFunction(toolName);
        if (!handler) {
            return {
                output: `[error] internal: handler "${toolName}" not found. The feature may not be available.`,
                exitCode: 1,
            };
        }

        const result = await handler(args);
        const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

        // Detect errors in the output
        if (output.startsWith('[error]') || output.startsWith('Error:')) {
            return { output, exitCode: 1 };
        }

        return { output, exitCode: 0 };
    } catch (err) {
        return {
            output: `[error] ${toolName}: ${err.message}`,
            exitCode: 1,
        };
    }
}
