/**
 * CLIExecutor — parses and executes CLI-style command strings with piping.
 * 
 * Syntax: COMMAND <name> <params> [| COMMAND <name> <params>]
 * 
 * Built-in commands:
 * - RECALL <query>              — search long-term memory
 * - REMEMBER <text>             — write to long-term memory
 * - GLOBAL_RECALL <query>       — search cross-workspace global memory
 * - GLOBAL_REMEMBER <text>      — promote to cross-workspace global memory
 * - CREATE <name> <function_body> — create a new tool dynamically
 * - ECHO <text>                 — echo text (useful in pipes)
 * - HTTP_GET <url>              — fetch a URL
 * - TOOLS                       — list available tools
 * - TOOL <name> <json_args>     — execute an ai-man tool by name
 * - NOOP                        — no operation
 *
 * Performance notes:
 * - Command list is cached and invalidated only when dynamic tools change.
 * - Tool name lookup uses a Map for O(1) resolution instead of linear scan.
 * - Pipe parsing has a fast path for single-command strings (no | character).
 * - Sandbox template is shared across invocations to reduce GC pressure.
 * - Dynamic tools cache their compiled vm.Script at creation time.
 *
 * @module src/core/agentic/lmscript/cli-executor
 */

import { RE_COMMAND, RE_DIRECT, splitPipe } from './cli-executor-helpers.mjs';
import { consoleStyler } from '../../../ui/console-styler.mjs';
import {
    cmdRecall,
    cmdRemember,
    cmdGlobalRecall,
    cmdGlobalRemember,
    cmdCreate,
    cmdEcho,
    cmdHttpGet,
    cmdTools,
    cmdTool,
    cmdNoop,
    executeDynamicTool,
} from './cli-executor-commands.mjs';

export class CLIExecutor {
    constructor(options = {}) {
        this.memory = options.memory;         // HolographicMemoryAdapter
        this.toolExecutor = options.toolExecutor;  // ai-man ToolExecutor
        this.workingDir = options.workingDir || process.cwd();
        this.eventBus = options.eventBus || null;
        
        // Whether the CREATE command is allowed (default: false for safety).
        // Set to true explicitly to allow AI-generated code execution via
        // Node.js vm (which is NOT a security sandbox).
        this.allowDynamicToolCreation = options.allowDynamicToolCreation ?? false;

        if (this.allowDynamicToolCreation) {
            consoleStyler.log('warning', 'CLIExecutor: allowDynamicToolCreation is enabled — AI-generated code can be executed via Node.js vm (not a security sandbox).');
        }

        // Dynamic tool registry
        this.dynamicTools = new Map();
        
        // Built-in command handlers — each receives (executor, args, pipeData, context)
        this.builtins = new Map([
            ['RECALL',          (a, p, c) => cmdRecall(this, a, p, c)],
            ['REMEMBER',        (a, p, c) => cmdRemember(this, a, p, c)],
            ['GLOBAL_RECALL',   (a, p, c) => cmdGlobalRecall(this, a, p, c)],
            ['GLOBAL_REMEMBER', (a, p, c) => cmdGlobalRemember(this, a, p, c)],
            ['CREATE',          (a, p, c) => cmdCreate(this, a, p, c)],
            ['ECHO',            (a, p, c) => cmdEcho(this, a, p, c)],
            ['HTTP_GET',        (a, p, c) => cmdHttpGet(this, a, p, c)],
            ['TOOLS',           (a, p, c) => cmdTools(this, a, p, c)],
            ['TOOL',            (a, p, c) => cmdTool(this, a, p, c)],
            ['NOOP',            (a, p, c) => cmdNoop(this, a, p, c)],
        ]);

        // Cached command list — invalidated when dynamic tools change
        this._cachedCommandList = null;

        // Cached tool name lookup map — lazily built from toolExecutor
        this._toolNameMap = null;
        this._toolNameMapVersion = 0;
    }

    /**
     * Get list of all available command names.
     * Uses a cached array that is invalidated when dynamic tools are added.
     * @returns {string[]}
     */
    getAvailableCommands() {
        if (this._cachedCommandList) return this._cachedCommandList;

        const builtinNames = Array.from(this.builtins.keys());
        const dynamicNames = Array.from(this.dynamicTools.keys());
        this._cachedCommandList = [...builtinNames, ...dynamicNames];
        return this._cachedCommandList;
    }

    /**
     * Parse and execute a CLI command string with pipe support.
     * Supports quoted arguments: `COMMAND REMEMBER "The user said hello"`
     * preserves the quoted string as a single argument.
     * 
     * @param {string} cmdString — e.g. "COMMAND RECALL 'project goals' | COMMAND ECHO"
     * @param {Object} context — execution context { signal }
     * @returns {Promise<string>} — final output
     */
    async execute(cmdString, context = {}) {
        if (!cmdString || !cmdString.trim()) {
            return 'No command provided.';
        }

        if (context.signal?.aborted) {
            return 'Execution aborted.';
        }

        // Fast path: no pipe operator → skip full pipe parsing
        const stages = cmdString.includes('|')
            ? splitPipe(cmdString)
            : [cmdString.trim()];

        let pipeData = null;
        const errors = [];

        for (const stage of stages) {
            if (context.signal?.aborted) {
                errors.push('Execution aborted.');
                break;
            }

            try {
                // Parse: COMMAND <name> <args...>
                const match = stage.match(RE_COMMAND);
                if (!match) {
                    // Try without COMMAND prefix for convenience
                    const directMatch = stage.match(RE_DIRECT);
                    if (directMatch) {
                        const [, cmdName, cmdArgs] = directMatch;
                        pipeData = await this._dispatch(cmdName.toUpperCase(), cmdArgs.trim(), pipeData, context);
                        continue;
                    }
                    errors.push(`Invalid command syntax: "${stage}". Expected: COMMAND <name> <params>`);
                    break;
                }

                const [, cmdName, cmdArgs] = match;
                pipeData = await this._dispatch(cmdName.toUpperCase(), cmdArgs.trim(), pipeData, context);
            } catch (err) {
                const errorMsg = `Error in command "${stage}": ${err.message}`;
                errors.push(errorMsg);
                pipeData = errorMsg;
                // Feed the error as pipe data so the next stage (if any) can process it
                break;
            }
        }

        if (errors.length > 0 && pipeData === null) {
            return errors.join('\n');
        }

        return pipeData !== null && pipeData !== undefined ? String(pipeData) : 'Command completed (no output).';
    }

    /**
     * Dispatch a command to the appropriate handler.
     * Uses O(1) lookups for builtins, dynamic tools, and ai-man tools.
     * @param {string} cmdName
     * @param {string} cmdArgs
     * @param {string|null} pipeData
     * @param {Object} context
     * @returns {Promise<string>}
     */
    async _dispatch(cmdName, cmdArgs, pipeData, context) {
        // Emit command event
        if (this.eventBus) {
            this.eventBus.emit('agentic:lmscript-command', {
                command: cmdName,
                args: cmdArgs?.substring(0, 200),
                hasPipe: pipeData !== null,
                timestamp: Date.now()
            });
        }

        // Check built-ins first (O(1) Map lookup)
        const builtin = this.builtins.get(cmdName);
        if (builtin) {
            return builtin(cmdArgs, pipeData, context);
        }

        // Check dynamic tools (O(1) Map lookup)
        if (this.dynamicTools.has(cmdName)) {
            return executeDynamicTool(this, cmdName, cmdArgs, pipeData, context);
        }

        // Check if it's an ai-man tool name (O(1) via cached name map)
        if (this.toolExecutor) {
            const toolName = this._resolveToolName(cmdName);
            if (toolName) {
                return cmdTool(this, `${toolName} ${cmdArgs}`, pipeData, context);
            }
        }

        return `Error: Unknown command "${cmdName}". Available: ${this.getAvailableCommands().join(', ')}`;
    }

    /**
     * Resolve a command name to an ai-man tool name using a cached lookup map.
     * Builds the map lazily on first use and invalidates when the tool count changes.
     * @param {string} cmdName — uppercase command name
     * @returns {string|null} — canonical tool name, or null if not found
     */
    _resolveToolName(cmdName) {
        if (!this.toolExecutor) return null;

        try {
            const toolDefs = this.toolExecutor.getAllToolDefinitions();
            const currentVersion = toolDefs.length;

            // Rebuild map if tool count changed (tools were added/removed)
            if (!this._toolNameMap || this._toolNameMapVersion !== currentVersion) {
                this._toolNameMap = new Map();
                for (const t of toolDefs) {
                    const name = t.function.name;
                    this._toolNameMap.set(name.toUpperCase(), name);
                    this._toolNameMap.set(name, name);
                }
                this._toolNameMapVersion = currentVersion;
            }

            return this._toolNameMap.get(cmdName) || this._toolNameMap.get(cmdName.toLowerCase()) || null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Get info about a dynamic tool.
     * @param {string} name
     * @returns {Object|null}
     */
    getDynamicToolInfo(name) {
        return this.dynamicTools.get(name.toUpperCase()) || null;
    }

    /**
     * List all dynamic tools.
     * @returns {Array<{name: string, createdAt: number, source: string}>}
     */
    listDynamicTools() {
        return Array.from(this.dynamicTools.entries()).map(([name, info]) => ({
            name,
            createdAt: info.createdAt,
            source: info.source.substring(0, 100) + (info.source.length > 100 ? '...' : '')
        }));
    }
}
