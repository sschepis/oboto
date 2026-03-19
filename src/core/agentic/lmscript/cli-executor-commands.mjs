/**
 * Built-in command handler implementations for the CLI executor.
 *
 * Each function receives `(executor, args, pipeData, context)` where
 * `executor` is the CLIExecutor instance, giving access to `memory`,
 * `toolExecutor`, `eventBus`, `workingDir`, `dynamicTools`, and `builtins`.
 *
 * Extracted from cli-executor.mjs to reduce file size while keeping
 * all behaviour identical.
 *
 * @module src/core/agentic/lmscript/cli-executor-commands
 */

import vm from 'node:vm';
import {
    DYNAMIC_TOOL_TIMEOUT,
    HTTP_TIMEOUT,
    SANDBOX_TEMPLATE,
    checkSSRF,
    extractQuotedOrRaw,
    withTimeout,
} from './cli-executor-helpers.mjs';

// ══════════════════════════════════════════════════════════════
// Built-in Command Handlers
// ══════════════════════════════════════════════════════════════

export async function cmdRecall(executor, args, pipeData, context) {
    const query = args || pipeData || '';
    if (!query) return 'RECALL requires a query string.';
    
    if (!executor.memory) return 'Memory system not available.';
    
    const results = await executor.memory.recall(query, { signal: context.signal });
    
    // Emit memory event
    if (executor.eventBus) {
        executor.eventBus.emit('agentic:lmscript-memory', {
            action: 'recall', query, resultCount: results.length, timestamp: Date.now()
        });
    }

    if (results.length === 0) return 'No memories found for query: ' + query;
    
    return results.map((r, i) => 
        `[${i + 1}] (${r.source}, score=${r.score.toFixed(2)}) ${r.text}`
    ).join('\n');
}

export async function cmdRemember(executor, args, pipeData, _context) {
    const text = extractQuotedOrRaw(args) || pipeData || '';
    if (!text) return 'REMEMBER requires text to store.';
    
    if (!executor.memory) return 'Memory system not available.';

    // Emit memory event
    if (executor.eventBus) {
        executor.eventBus.emit('agentic:lmscript-memory', {
            action: 'remember', textLength: text.length, timestamp: Date.now()
        });
    }
    
    return executor.memory.remember(text);
}

export async function cmdGlobalRecall(executor, args, pipeData, _context) {
    const query = args || pipeData || '';
    if (!query) return 'GLOBAL_RECALL requires a query string.';
    
    if (!executor.memory) return 'Memory system not available.';
    
    try {
        const results = await executor.memory.recallGlobal(query);

        // Emit memory event
        if (executor.eventBus) {
            executor.eventBus.emit('agentic:lmscript-memory', {
                action: 'global_recall', query, resultCount: results.length, timestamp: Date.now()
            });
        }

        if (results.length === 0) return 'No global memories found for query: ' + query;
        
        return results.map((r, i) => 
            `[${i + 1}] (${r.source}, score=${r.score.toFixed(2)}) ${r.text}`
        ).join('\n');
    } catch (err) {
        return `GLOBAL_RECALL error: ${err.message}`;
    }
}

export async function cmdGlobalRemember(executor, args, pipeData, _context) {
    const text = extractQuotedOrRaw(args) || pipeData || '';
    if (!text) return 'GLOBAL_REMEMBER requires text to store.';
    
    if (!executor.memory) return 'Memory system not available.';

    // Emit memory event
    if (executor.eventBus) {
        executor.eventBus.emit('agentic:lmscript-memory', {
            action: 'global_remember', textLength: text.length, timestamp: Date.now()
        });
    }
    
    return executor.memory.rememberGlobal(text);
}

// SECURITY NOTE: Node.js `vm` module does NOT provide a true security sandbox.
// Dynamic tools are convenience features for the agent, NOT security boundaries.
// Do not expose the CREATE command to untrusted user inputs without additional
// isolation (e.g. `isolated-vm` npm package or a subprocess sandbox).
// Set CLIExecutor option `allowDynamicToolCreation: false` to disable this command.
export async function cmdCreate(executor, args, _pipeData, _context) {
    // Guard: reject if dynamic tool creation is disabled via config
    if (executor.allowDynamicToolCreation === false) {
        return 'CREATE is disabled. Set allowDynamicToolCreation: true in CLIExecutor options to enable dynamic tool creation.';
    }

    if (!args || !args.trim()) {
        return 'CREATE syntax: COMMAND CREATE <name> function(context, params) { ... }';
    }

    // Parse: CREATE <name> <function_body>
    const match = args.match(/^(\w+)\s+(function[\s\S]*|async\s+function[\s\S]*|\([\s\S]*?\)\s*=>[\s\S]*)/i);
    if (!match) {
        return 'CREATE syntax: COMMAND CREATE <name> function(context, params) { ... }\nThe function body must start with "function", "async function", or an arrow expression.';
    }

    const [, toolName, funcBody] = match;
    const upperName = toolName.toUpperCase();

    // Prevent overwriting built-in commands
    if (executor.builtins.has(upperName)) {
        return `CREATE failed: cannot overwrite built-in command "${upperName}".`;
    }

    // Security: Compile and validate in a sandboxed VM context
    try {
        const sandbox = { ...SANDBOX_TEMPLATE };
        const script = new vm.Script(`'use strict'; (${funcBody})`, {
            timeout: 5000,
            filename: `dynamic-tool-${upperName}.js`
        });

        const ctx = vm.createContext(sandbox);
        const fn = script.runInContext(ctx, { timeout: 5000 });

        if (typeof fn !== 'function') {
            return 'CREATE failed: expression did not evaluate to a function.';
        }

        // Cache the compiled script for faster re-execution
        executor.dynamicTools.set(upperName, {
            fn,
            compiledScript: script,
            name: upperName,
            source: funcBody,
            createdAt: Date.now()
        });

        // Invalidate command list cache
        executor._cachedCommandList = null;

        // Emit tool-created event
        if (executor.eventBus) {
            executor.eventBus.emit('agentic:lmscript-tool-created', {
                name: upperName, timestamp: Date.now()
            });
        }

        return `Tool "${upperName}" created successfully. Use: COMMAND ${upperName} <params>`;
    } catch (err) {
        return `CREATE failed: ${err.message}`;
    }
}

export async function cmdEcho(_executor, args, pipeData, _context) {
    return extractQuotedOrRaw(args) || pipeData || '';
}

export async function cmdHttpGet(_executor, args, pipeData, context) {
    const url = args || pipeData || '';
    if (!url) return 'HTTP_GET requires a URL.';

    // SSRF protection — block private/internal/link-local addresses
    const ssrfCheck = checkSSRF(url);
    if (ssrfCheck.blocked) {
        return `HTTP_GET error: ${ssrfCheck.reason}`;
    }

    try {
        // Compose an AbortSignal combining the context signal and a timeout
        const timeoutSignal = AbortSignal.timeout(HTTP_TIMEOUT);
        const signals = [timeoutSignal];
        if (context.signal) signals.push(context.signal);

        // AbortSignal.any requires Node 20+; fall back gracefully
        let combinedSignal;
        try {
            combinedSignal = AbortSignal.any(signals);
        } catch {
            combinedSignal = context.signal || timeoutSignal;
        }

        const response = await fetch(url, {
            headers: { 'User-Agent': 'LMScript-Agent/1.0' },
            signal: combinedSignal,
            redirect: 'manual'
        });
        // Block redirects to private/internal addresses (SSRF via 302)
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location') || '(unknown)';
            const locCheck = checkSSRF(location);
            if (locCheck.blocked) {
                return `HTTP_GET error: Redirect to blocked address (${response.status} → ${location}) — ${locCheck.reason}`;
            }
            return `HTTP_GET: Server returned redirect ${response.status} → ${location}. Use that URL directly if needed.`;
        }
        const text = await response.text();
        // Truncate to avoid flooding context
        return text.length > 4000 ? text.substring(0, 4000) + '\n... [truncated]' : text;
    } catch (err) {
        return `HTTP_GET error: ${err.message}`;
    }
}

export async function cmdTools(executor, _args, _pipeData, _context) {
    const commands = executor.getAvailableCommands();
    const parts = ['Available CLI Commands:'];
    parts.push(commands.map(c => `  - ${c}`).join('\n'));

    if (executor.toolExecutor) {
        try {
            const toolDefs = executor.toolExecutor.getAllToolDefinitions();
            parts.push('\nAvailable AI-Man Tools:');
            parts.push(toolDefs.map(t => `  - ${t.function.name}: ${t.function.description || ''}`).join('\n'));
        } catch (err) {
            parts.push(`\nError listing AI-Man tools: ${err.message}`);
        }
    }

    return parts.join('\n');
}

export async function cmdTool(executor, args, pipeData, _context) {
    if (!executor.toolExecutor) return 'Tool executor not available.';

    if (!args || !args.trim()) {
        return 'TOOL syntax: COMMAND TOOL <name> <json_args>';
    }

    // Parse: TOOL <name> <json_args>
    const match = args.match(/^(\w+)\s*([\s\S]*)/);
    if (!match) return 'TOOL syntax: COMMAND TOOL <name> <json_args>';

    const [, toolName, rawArgs] = match;
    let parsedArgs = {};

    if (rawArgs.trim()) {
        try {
            parsedArgs = JSON.parse(rawArgs.trim());
        } catch (_e) {
            // Try treating it as a simple string argument
            parsedArgs = { input: rawArgs.trim() };
        }
    }

    // If there's pipe data, add it as context
    if (pipeData) {
        parsedArgs._pipeInput = pipeData;
    }

    try {
        const toolCall = {
            id: `lmscript_${Date.now()}`,
            function: {
                name: toolName,
                arguments: JSON.stringify(parsedArgs)
            }
        };
        const result = await executor.toolExecutor.executeTool(toolCall);
        return result?.content || 'Tool returned no output.';
    } catch (err) {
        return `TOOL error (${toolName}): ${err.message}`;
    }
}

export async function cmdNoop(_executor, _args, _pipeData, _context) {
    return 'No operation performed.';
}

// ══════════════════════════════════════════════════════════════
// Dynamic tool execution
// ══════════════════════════════════════════════════════════════

/**
 * Execute a dynamically created tool using its cached compiled script.
 * @param {Object} executor — CLIExecutor instance
 * @param {string} cmdName
 * @param {string} cmdArgs
 * @param {string|null} pipeData
 * @param {Object} context
 * @returns {Promise<string>}
 */
export async function executeDynamicTool(executor, cmdName, cmdArgs, pipeData, context) {
    const tool = executor.dynamicTools.get(cmdName);
    if (!tool) return `Dynamic tool "${cmdName}" not found.`;

    try {
        // Create a fresh sandbox using the shared template + SSRF-protected fetch.
        // The fetch proxy is frozen to prevent prototype-chain traversal from
        // the sandbox back to the host globalThis (e.g. fetch.constructor → Function).
        const _ssrfFetch = Object.freeze(async (url, opts = {}) => {
            const ssrf = checkSSRF(url);
            if (ssrf.blocked) {
                throw new Error(`Dynamic tool fetch blocked: ${ssrf.reason}`);
            }
            // Disable automatic redirect following to prevent SSRF via 302
            // to internal addresses (the initial URL passes the check but the
            // redirect target may point to 169.254.x.x, localhost, etc.).
            const resp = await globalThis.fetch(url, { ...opts, redirect: 'manual' });
            if (resp.status >= 300 && resp.status < 400) {
                const location = resp.headers.get('location') || '(unknown)';
                throw new Error(`Redirect blocked (${resp.status} → ${location}) — SSRF prevention`);
            }
            return resp;
        });
        const sandbox = {
            ...SANDBOX_TEMPLATE,
            fetch: _ssrfFetch,
        };

        const ctx = vm.createContext(sandbox);
        
        // Use the cached compiled script instead of re-compiling from source
        const fn = tool.compiledScript.runInContext(ctx, { timeout: 10000 });

        const execContext = { pipeData, workingDir: executor.workingDir };
        
        // Bind `this` to a frozen null-prototype object to prevent
        // prototype chain traversal escaping the vm sandbox
        // (e.g. this.constructor.constructor('return process')()).
        const safeThis = Object.freeze(Object.create(null));
        
        // Wrap Promise.resolve in a timeout to handle async tools that hang
        const resultPromise = Promise.resolve(fn.call(safeThis, execContext, cmdArgs));
        const result = await withTimeout(
            resultPromise,
            DYNAMIC_TOOL_TIMEOUT,
            `Dynamic tool "${cmdName}" timed out after ${DYNAMIC_TOOL_TIMEOUT}ms`
        );
        
        return result !== undefined ? String(result) : 'Command completed.';
    } catch (err) {
        if (context.signal?.aborted) {
            return `Dynamic tool "${cmdName}" aborted.`;
        }
        return `Dynamic tool "${cmdName}" error: ${err.message}`;
    }
}
