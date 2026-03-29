/**
 * Command Router — Central dispatch for the unified `run` CLI tool
 *
 * Routes commands to the appropriate handler, manages the command registry,
 * provides progressive help discovery, and executes chains.
 *
 * Architecture:
 *   run(command="...") → parseChain → for each segment: parseCommand → dispatch
 *                                                                        ↓
 *                                                          file-commands / shell-commands / agent-commands
 *
 * The router is initialized with references to FileTools, ShellTools, and ToolExecutor
 * to bind CLI commands to existing infrastructure.
 */

import { parseChain, parseCommand, executeChain } from './chain-parser.mjs';
import { presentToolOutput } from './output-presenter.mjs';
import { createFileCommands } from './cli-commands/file-commands.mjs';
import { createShellCommands } from './cli-commands/shell-commands.mjs';
import { createAgentCommands } from './cli-commands/agent-commands.mjs';

export class CommandRouter {
    /**
     * @param {object} options
     * @param {import('../tools/file-tools.mjs').FileTools} options.fileTools
     * @param {import('../tools/shell-tools.mjs').ShellTools} options.shellTools
     * @param {import('./tool-executor.mjs').ToolExecutor} options.toolExecutor
     */
    constructor({ fileTools, shellTools, toolExecutor }) {
        this.fileTools = fileTools;
        this.shellTools = shellTools;
        this.toolExecutor = toolExecutor;

        /** @type {Map<string, { help: string, usage: string, execute: Function }>} */
        this.commands = new Map();

        this._registerCommands();
    }

    /**
     * Register all CLI commands from the command modules.
     */
    _registerCommands() {
        // File commands
        const fileCommands = createFileCommands(this.fileTools);
        for (const [name, cmd] of Object.entries(fileCommands)) {
            this.commands.set(name, cmd);
        }

        // Shell commands
        const shellCommands = createShellCommands(this.shellTools);
        for (const [name, cmd] of Object.entries(shellCommands)) {
            this.commands.set(name, cmd);
        }

        // Agent commands
        const agentCommands = createAgentCommands(this.toolExecutor);
        for (const [name, cmd] of Object.entries(agentCommands)) {
            this.commands.set(name, cmd);
        }

        // Built-in help command
        this.commands.set('help', {
            help: 'Show available commands or help for a specific command.',
            usage: 'help [command]',
            execute: async (args) => {
                if (args.length > 0) {
                    const cmdName = args[0];
                    const cmd = this.commands.get(cmdName);
                    if (!cmd) {
                        return {
                            output: `[error] help: unknown command "${cmdName}". Use: help (no args) to list all commands.`,
                            exitCode: 1,
                        };
                    }
                    return {
                        output: `${cmdName}: ${cmd.help}\n\nUsage: ${cmd.usage}`,
                        exitCode: 0,
                    };
                }

                // List all commands
                return {
                    output: this.generateCommandList(),
                    exitCode: 0,
                };
            },
        });
    }

    /**
     * Generate the compact command list for the tool description.
     * @returns {string}
     */
    generateCommandList() {
        const lines = ['Available commands:'];
        for (const [name, cmd] of this.commands) {
            lines.push(`  ${name.padEnd(10)} — ${cmd.help}`);
        }
        lines.push('');
        lines.push('Operators: | (pipe) && (and) || (or) ; (seq)');
        lines.push('Run a command with no args for detailed usage.');
        return lines.join('\n');
    }

    /**
     * Generate the dynamic description for the `run` tool definition.
     * This is injected into the tool schema at conversation start.
     * @returns {string}
     */
    generateToolDescription() {
        const cmdLines = [];
        for (const [name, cmd] of this.commands) {
            cmdLines.push(`  ${name.padEnd(10)} — ${cmd.help}`);
        }

        return [
            'Execute CLI-style commands with Unix pipe and chain support.',
            'Supports: | (pipe stdout), && (if success), || (if failure), ; (sequential).',
            '',
            'Available commands:',
            ...cmdLines,
            '',
            'Examples:',
            '  cat file.txt | grep ERROR | wc -l',
            '  ls src -r | grep test',
            '  exec npm test && echo "tests passed" || echo "tests failed"',
            '  skill list ; memory query "recent changes"',
            '',
            'Run a command with no args for detailed usage.',
        ].join('\n');
    }

    /**
     * Execute a full command string (may contain pipes, chains).
     * This is the main entry point called by the `run` tool handler.
     *
     * @param {string} commandString — the raw command from the LLM
     * @returns {Promise<string>} — processed output ready for LLM context
     */
    async execute(commandString) {
        const startTime = Date.now();

        if (!commandString || typeof commandString !== 'string' || !commandString.trim()) {
            return this.generateCommandList();
        }

        // Parse the chain
        const chain = parseChain(commandString);

        if (chain.length === 0) {
            return '[error] run: empty command. ' + this.generateCommandList();
        }

        // Execute the chain
        const result = await executeChain(chain, async (cmdStr, stdin) => {
            return this._executeSingleCommand(cmdStr, stdin);
        });

        const durationMs = Date.now() - startTime;

        // Apply presentation layer to the final output (async for overflow writes)
        return await presentToolOutput(result.output, {
            toolName: 'run',
            durationMs,
            exitCode: result.exitCode,
        });
    }

    /**
     * Execute a single command (no pipes/chains — just the command + args).
     *
     * @param {string} cmdStr — e.g. 'grep ERROR file.txt'
     * @param {string} [stdin] — piped input from previous command
     * @returns {Promise<{ output: string, exitCode: number }>}
     */
    async _executeSingleCommand(cmdStr, stdin) {
        const { name, args } = parseCommand(cmdStr);

        if (!name) {
            return { output: '[error] run: empty command segment', exitCode: 1 };
        }

        // Look up the command
        const cmd = this.commands.get(name);

        if (!cmd) {
            // Unknown command — provide navigational error
            const available = Array.from(this.commands.keys()).join(', ');
            return {
                output: `[error] unknown command: ${name}. Available: ${available}`,
                exitCode: 127,
            };
        }

        // Execute the command
        try {
            return await cmd.execute(args, stdin);
        } catch (err) {
            return {
                output: `[error] ${name}: ${err.message}`,
                exitCode: 1,
            };
        }
    }
}
