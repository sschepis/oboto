import { VM } from 'vm2';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { dryRunGuard } from '../dry-run-guard.mjs';

export class CoreHandlers {
    constructor(packageManager, historyManager, memoryAdapter) {
        this.packageManager = packageManager;
        this.historyManager = historyManager;
        this.memoryAdapter = memoryAdapter;
    }

    // Read full conversation history
    async readConversationHistory(args) {
        if (!this.historyManager) {
            return "Error: History manager not available.";
        }
        
        const { limit = 50, offset = 0 } = args;
        let messages = this.historyManager.getHistory();
        
        // Skip system prompt if desired? No, keep it as it's part of history.
        // But usually we want recent history.
        
        if (offset > 0) {
            // Remove last 'offset' messages
            if (offset >= messages.length) return "[]";
            messages = messages.slice(0, -offset);
        }
        
        if (limit !== -1) {
            // Take last 'limit' messages
            messages = messages.slice(-limit);
        }
        
        return JSON.stringify(messages, null, 2);
    }

    // Promote memory to global store
    async promoteMemory(args) {
        if (!this.memoryAdapter || typeof this.memoryAdapter.promoteToGlobal !== 'function') {
            return "Error: Global Holographic Memory not available.";
        }

        const { text, category, importance } = args;
        const metadata = { category, importance };
        
        try {
            await this.memoryAdapter.promoteToGlobal(text, metadata);
            return `✓ Memory promoted to Global Holographic Field: "${text.substring(0, 50)}..."`;
        } catch (error) {
            return `Error promoting memory: ${error.message}`;
        }
    }

    // Query global memory
    async queryGlobalMemory(args) {
        if (!this.memoryAdapter || typeof this.memoryAdapter.queryGlobal !== 'function') {
            return "Error: Global Holographic Memory not available.";
        }

        const { query, limit } = args;
        
        try {
            const results = await this.memoryAdapter.queryGlobal(query, limit);
            if (results.length === 0) {
                return "No matching memories found in Global Holographic Field.";
            }
            return JSON.stringify(results, null, 2);
        } catch (error) {
            return `Error querying global memory: ${error.message}`;
        }
    }

    // Execute npm function tool
    async executeNpmFunction(args, dryRun, plannedChanges) {
        if (dryRun) {
            return dryRunGuard(dryRun, plannedChanges, {
                type: 'npm_function',
                packageName: args.packageName,
                functionName: args.functionName,
                args: args.args,
                preview: `Call ${args.packageName}.${args.functionName}`
            }, () => {});
        }

        const { packageName, functionName: funcToCall, args: funcArgs } = args;
        
        consoleStyler.log('packages', `Loading package: ${packageName}`);
        
        let module;
        try {
            module = await this.packageManager.importPackage(packageName);
            consoleStyler.log('packages', `✓ Package ${packageName} loaded successfully`);
        } catch (e) {
            if (e.code === 'ERR_MODULE_NOT_FOUND') {
                consoleStyler.log('packages', `Package ${packageName} not found, installing...`);
                try {
                    await this.packageManager.installPackage(packageName);
                    consoleStyler.log('packages', `✓ Package ${packageName} installed successfully`);
                    module = await this.packageManager.importPackage(packageName);
                } catch (installError) {
                    if (installError.message.startsWith('COMPATIBILITY_SKIP:')) {
                        consoleStyler.log('error', `Package ${packageName} incompatible with current Node.js version`);
                        throw new Error(`Cannot use ${packageName} due to Node.js compatibility issues. Please use built-in alternatives.`);
                    }
                    throw installError;
                }
            } else {
                throw e;
            }
        }

        const func = funcToCall === 'default' ? module.default : module[funcToCall];
        if (typeof func !== 'function') {
            throw new Error(`'${funcToCall}' is not a function in package '${packageName}'.`);
        }

        const toolResult = await func(...funcArgs);
        return toolResult === undefined ? "Function executed successfully" : (typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2));
    }

    // Execute JavaScript code tool
    async executeJavaScript(args, dryRun, plannedChanges) {
        if (dryRun) {
            return dryRunGuard(dryRun, plannedChanges, {
                type: 'javascript',
                codeLength: args.code.length,
                preview: args.code.substring(0, 100) + (args.code.length > 100 ? '...' : '')
            }, () => {});
        }

        const {
            code: codeToRun,
            npm_packages: packagesToInstall,
            save_as_tool = false,
            tool_name,
            tool_description,
            tool_category = 'utility'
        } = args;

        if (packagesToInstall && packagesToInstall.length > 0) {
            consoleStyler.log('packages', `Installing ${packagesToInstall.length} package(s): ${packagesToInstall.join(', ')}`);
            const results = await this.packageManager.installPackages(packagesToInstall);
            this.packageManager.logInstallationResults(results);
        }

        consoleStyler.log('working', 'Setting up JavaScript execution environment...');
        // Set up require function for CommonJS modules
        const require = await this.packageManager.setupCommonJSRequire();
        
        consoleStyler.log('working', 'Executing JavaScript code...');
        
        // Use vm2 for sandboxed execution
        const vm = new VM({
            timeout: 30000, // 30s timeout
            sandbox: {
                console: console,
                require: require,
                process: {
                    env: { ...process.env },
                    cwd: process.cwd
                },
                Buffer: Buffer,
                setTimeout: setTimeout,
                clearTimeout: clearTimeout,
                setInterval: setInterval,
                clearInterval: clearInterval
            }
        });

        // Execute the code in the sandbox
        let toolResult;
        try {
            // Fix: vm2 does not support dynamic import(), so we replace it with require()
            // This assumes the module is available via CommonJS require (which we inject)
            const processedCode = codeToRun.replace(/import\s*\(\s*(['"`].*?['"`])\s*\)/g, 'Promise.resolve(require($1))');

            // Always wrap in an async IIFE so bare `return` statements work
            // and async/await is supported naturally.
            const wrappedCode = `(async () => { ${processedCode} })()`;
            toolResult = await vm.run(wrappedCode);
            
            // If result is a promise (from async code), await it
            if (toolResult && typeof toolResult.then === 'function') {
                toolResult = await toolResult;
            }
        } catch (err) {
            throw new Error(`Execution error: ${err.message}`);
        }

        let resultText = toolResult === undefined ? "Code executed successfully" : JSON.stringify(toolResult, null, 2);
        
        consoleStyler.log('working', '✓ JavaScript execution completed');

        // Handle tool creation if requested
        if (save_as_tool) {
            if (!tool_name || !tool_description) {
                resultText += '\n\n✗ Tool creation failed: tool_name and tool_description are required when save_as_tool is true';
            } else {
                consoleStyler.log('tools', `Creating tool: ${tool_name}`);
                const toolCreationResult = await this.processIntoTool(
                    codeToRun,
                    tool_name,
                    tool_description,
                    tool_category,
                    packagesToInstall || []
                );
                resultText += '\n\n' + toolCreationResult;
            }
        }

        return resultText;
    }

    // Process code into a tool (helper method)
    async processIntoTool(originalCode, toolName, toolDescription, category, npmPackages = []) {
        try {
            consoleStyler.log('tools', `Processing code into tool: ${toolName}`);
            // This would need the AI generation logic moved here or injected
            // For now, return a placeholder
            return `✗ Tool creation not yet implemented in refactored version`;
        } catch (error) {
            consoleStyler.log('error', `Tool processing failed: ${error.message}`);
            return `✗ Tool creation failed: ${error.message}`;
        }
    }
}
