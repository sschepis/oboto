// Tool execution logic
// Handles the execution of all different types of tools

import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import { VM } from 'vm2';
import { consoleStyler } from '../ui/console-styler.mjs';
import { FileTools } from '../tools/file-tools.mjs';
import { DesktopAutomationTools } from '../tools/desktop-automation-tools.mjs';
import { ManifestManager } from '../structured-dev/manifest-manager.mjs';
import { FlowManager } from '../structured-dev/flow-manager.mjs';
import { ImplementationPlanner } from '../structured-dev/implementation-planner.mjs';
import { PlanExecutor } from '../structured-dev/plan-executor.mjs';
import { CodeValidator } from '../quality/code-validator.mjs';

const execPromise = util.promisify(exec);

export class ToolExecutor {
    constructor(packageManager, customToolsManager, workspaceManager, aiAssistantClass = null) {
        this.packageManager = packageManager;
        this.customToolsManager = customToolsManager;
        this.workspaceManager = workspaceManager;
        this.aiAssistantClass = aiAssistantClass;
        this.currentTodos = null;
        this.errorHistory = [];
        this.recursionLevel = 0;
        
        this.fileTools = new FileTools();
        this.desktopTools = new DesktopAutomationTools();
        
        // Initialize structured development managers
        // Use the workspace root if available, otherwise process.cwd()
        const workspaceRoot = workspaceManager?.workspaceRoot || process.cwd();
        
        // Re-initialize file tools with the correct workspace root
        this.fileTools = new FileTools(workspaceRoot);
        
        this.manifestManager = new ManifestManager(workspaceRoot);
        this.flowManager = new FlowManager(this.manifestManager);
        this.implementationPlanner = new ImplementationPlanner(this.manifestManager);
        this.codeValidator = new CodeValidator(workspaceRoot);
        
        // Pass aiAssistantClass if available, otherwise it will fail at runtime if execute_implementation_plan is called
        this.planExecutor = new PlanExecutor(this.manifestManager, this.aiAssistantClass);

        // Initialize tool registry
        this.toolRegistry = new Map();
        this.registerBuiltInTools();
    }

    // Register all built-in tools
    registerBuiltInTools() {
        // NPM and JavaScript tools
        this.registerTool('execute_npm_function', this.executeNpmFunction.bind(this));
        this.registerTool('execute_javascript', this.executeJavaScript.bind(this));
        
        // Task management tools
        this.registerTool('create_todo_list', this.createTodoList.bind(this));
        this.registerTool('update_todo_status', this.updateTodoStatus.bind(this));
        
        // Reasoning and quality tools
        this.registerTool('analyze_and_recover', this.analyzeAndRecover.bind(this));
        this.registerTool('embellish_request', this.embellishRequest.bind(this));
        this.registerTool('evaluate_response_quality', this.evaluateResponseQuality.bind(this));
        
        // Utility tools
        this.registerTool('speak_text', this.speakText.bind(this));
        this.registerTool('search_web', this.searchWeb.bind(this));
        
        // Custom tool management
        this.registerTool('list_custom_tools', this.listCustomTools.bind(this));
        this.registerTool('remove_custom_tool', this.removeCustomTool.bind(this));
        this.registerTool('export_tools', this.exportTools.bind(this));
        
        // System tools
        this.registerTool('manage_workspace', this.manageWorkspace.bind(this));
        this.registerTool('call_ai_assistant', this.callAiAssistant.bind(this));
        
        // Structured Development tools
        this.registerTool('init_structured_dev', this.initStructuredDev.bind(this));
        this.registerTool('bootstrap_project', this.bootstrapProject.bind(this));
        this.registerTool('submit_technical_design', this.submitTechnicalDesign.bind(this));
        this.registerTool('approve_design', this.approveDesign.bind(this));
        this.registerTool('lock_interfaces', this.lockInterfaces.bind(this));
        this.registerTool('submit_critique', this.submitCritique.bind(this));
        this.registerTool('read_manifest', this.readManifest.bind(this));
        this.registerTool('visualize_architecture', this.visualizeArchitecture.bind(this));
        this.registerTool('rollback_to_snapshot', this.rollbackToSnapshot.bind(this));
        
        // Multi-Agent Implementation Tools
        this.registerTool('create_implementation_plan', this.createImplementationPlan.bind(this));
        this.registerTool('execute_implementation_plan', this.executeImplementationPlan.bind(this));

        // File system tools
        this.registerTool('read_file', this.fileTools.readFile.bind(this.fileTools));
        this.registerTool('write_file', this.writeFileWithValidation.bind(this));
        this.registerTool('list_files', this.fileTools.listFiles.bind(this.fileTools));

        // Desktop automation tools
        this.registerTool('mouse_move', this.desktopTools.moveMouse.bind(this.desktopTools));
        this.registerTool('mouse_click', this.desktopTools.clickMouse.bind(this.desktopTools));
        this.registerTool('keyboard_type', this.desktopTools.typeText.bind(this.desktopTools));
        this.registerTool('keyboard_press', this.desktopTools.pressKey.bind(this.desktopTools));
        this.registerTool('screen_capture', this.desktopTools.captureScreen.bind(this.desktopTools));
    }

    // Register a new tool
    registerTool(name, handler) {
        this.toolRegistry.set(name, handler);
    }

    // Execute a tool call and return the result
    async executeTool(toolCall) {
        const functionName = toolCall.function.name;
        let toolResultText = '';

        try {
            consoleStyler.log('tools', `🔧 Starting ${functionName}...`);
            const args = JSON.parse(toolCall.function.arguments);
            
            // Log tool arguments for debugging (truncated for readability)
            const argsSummary = Object.keys(args).length > 0
                ? Object.keys(args).map(key => `${key}: ${typeof args[key]}`).join(', ')
                : 'no arguments';
            consoleStyler.log('tools', `   Parameters: ${argsSummary}`, { indent: true });

            // Check if tool is registered
            if (this.toolRegistry.has(functionName)) {
                const handler = this.toolRegistry.get(functionName);
                toolResultText = await handler(args);
            }
            // Check if it's a custom tool
            else if (this.customToolsManager.hasCustomTool(functionName)) {
                toolResultText = await this.customToolsManager.executeCustomTool(functionName, args);
            }
            else {
                throw new Error(`Unknown tool: ${functionName}`);
            }

            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: toolResultText,
            };

        } catch (error) {
            consoleStyler.log('error', `Tool Error: ${error.message}`);
            return {
                role: 'tool',
                tool_call_id: toolCall.id,
                name: functionName,
                content: `Error: ${error.message}`,
            };
        }
    }

    // Execute npm function tool
    async executeNpmFunction(args) {
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
    async executeJavaScript(args) {
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

    // Create todo list tool
    async createTodoList(args) {
        const { task_description, todos } = args;
        
        this.currentTodos = {
            task: task_description,
            items: todos,
            created_at: new Date().toISOString()
        };
        
        // Use the enhanced todo list display
        const todoDisplay = consoleStyler.formatTodoList(this.currentTodos);
        console.log(todoDisplay);
        
        return `Todo list created with ${todos.length} steps`;
    }

    // Update todo status tool
    async updateTodoStatus(args) {
        const { step_index, status, result } = args;
        
        if (this.currentTodos && this.currentTodos.items[step_index]) {
            this.currentTodos.items[step_index].status = status;
            if (result) {
                this.currentTodos.items[step_index].result = result;
            }
            
            const todo = this.currentTodos.items[step_index];
            const statusText = status === 'completed' ? 'completed' : status === 'in_progress' ? 'in progress' : 'pending';
            consoleStyler.log('todo', `Step ${step_index + 1} ${statusText}: ${todo.step}${result ? ` - ${result}` : ''}`);
            
            // Show current task being worked on
            if (status === 'in_progress') {
                consoleStyler.log('working', `Currently working on: ${todo.step}`);
            }
            
            return `Step ${step_index + 1} status updated to ${status}`;
        } else {
            return `Error: Invalid step index or no active todo list`;
        }
    }

    // Analyze and recover tool
    async analyzeAndRecover(args) {
        const { error_message, failed_approach, recovery_strategy, alternative_code } = args;
        
        this.errorHistory.push({
            error: error_message,
            approach: failed_approach,
            strategy: recovery_strategy,
            timestamp: new Date().toISOString()
        });
        
        consoleStyler.log('recovery', `🔍 Analyzing error: ${error_message}`, { box: true });
        consoleStyler.log('recovery', `Failed approach: ${failed_approach}`);
        consoleStyler.log('recovery', `Attempting recovery strategy: ${recovery_strategy}`);
        
        let recoveryResult = "";
        
        switch (recovery_strategy) {
            case 'retry_with_alternative':
                if (alternative_code) {
                    try {
                        await this.packageManager.setupCommonJSRequire();
                        const result = await Promise.resolve(eval(alternative_code));
                        recoveryResult = result === undefined ? "Recovery successful - code executed" : `Recovery successful: ${JSON.stringify(result)}`;
                    } catch (e) {
                        recoveryResult = `Recovery failed: ${e.message}`;
                        consoleStyler.log('recovery', `✗ Alternative also failed: ${e.message}`);
                    }
                } else {
                    recoveryResult = "No alternative code provided";
                }
                break;
                
            case 'simplify_approach':
                recoveryResult = "Breaking down into simpler steps";
                break;
                
            case 'change_method':
                recoveryResult = "Switching to different method";
                break;
                
            case 'install_dependencies':
                recoveryResult = "Installing missing dependencies";
                break;
                
            case 'fix_syntax':
                recoveryResult = "Fixing syntax errors";
                break;
                
            default:
                recoveryResult = "Unknown recovery strategy";
        }
        
        return recoveryResult;
    }

    // Embellish request tool
    async embellishRequest(args) {
        const { original_request, embellished_request, technical_requirements, reasoning_effort, reasoning_justification } = args;
        
        consoleStyler.log('reasoning', `🧠 Request embellishment complete:`);
        consoleStyler.log('reasoning', `   Original: ${original_request.substring(0, 60)}...`, { indent: true });
        consoleStyler.log('reasoning', `   Enhanced: ${embellished_request.substring(0, 60)}...`, { indent: true });
        consoleStyler.log('reasoning', `   Technical requirements: ${technical_requirements ? technical_requirements.length : 0}`, { indent: true });
        consoleStyler.log('reasoning', `   Reasoning effort: ${reasoning_effort}`, { indent: true });
        
        return `Request embellished with ${technical_requirements ? technical_requirements.length : 0} technical requirements. Reasoning: ${reasoning_effort}`;
    }

    // Evaluate response quality tool
    async evaluateResponseQuality(args) {
        const { original_query, ai_response, quality_rating = 0, evaluation_reasoning = "No reasoning", remedy_suggestion = "" } = args;
        
        if (quality_rating < 4) {
            consoleStyler.log('quality', `Poor quality detected (${quality_rating}/10)`, { box: true });
            if (remedy_suggestion) {
                consoleStyler.log('quality', `Remedy: ${remedy_suggestion}`);
            }
            
            return `Quality rating ${quality_rating}/10 - retry needed with remedy: ${remedy_suggestion}`;
        } else {
            consoleStyler.log('quality', `Quality rating ${quality_rating}/10 - response approved`);
            return `Quality rating ${quality_rating}/10 - response approved`;
        }
    }

    // Speak text tool (Text-to-Speech)
    async speakText(args) {
        const {
            text,
            voice_id = 'tQ4MEZFJOzsahSEEZtHK',
            stability = 0.5,
            similarity_boost = 0.75
        } = args;
        
        const spinner = consoleStyler.startSpinner('tts', 'Converting text to speech...');
        
        try {
            // Clean the text (remove markdown formatting)
            const cleanText = text
                .replace(/```[\s\S]*?```/g, '') // Remove code blocks
                .replace(/`[^`]+`/g, '') // Remove inline code
                .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold markdown
                .replace(/\*([^*]+)\*/g, '$1') // Remove italic markdown
                .replace(/#{1,6}\s+/g, '') // Remove headers
                .replace(/\|[^|\n]*\|/g, '') // Remove table rows
                .replace(/\n+/g, ' ') // Replace newlines with spaces
                .trim();

            // Get ElevenLabs API key from environment
            const apiKey = process.env.ELEVENLABS_API_KEY;
            if (!apiKey) {
                throw new Error('ELEVENLABS_API_KEY environment variable not set');
            }

            // Call ElevenLabs API
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': apiKey
                },
                body: JSON.stringify({
                    text: cleanText,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: stability,
                        similarity_boost: similarity_boost
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
            }

            // Save audio file
            const audioBuffer = await response.arrayBuffer();
            const audioFilePath = path.join(process.cwd(), 'temp_speech.mp3');
            
            // Write audio file
            const fs = await import('fs');
            fs.writeFileSync(audioFilePath, Buffer.from(audioBuffer));

            // Play audio (platform-specific)
            const os = await import('os');
            const platform = os.platform();
            
            let playCommand;
            if (platform === 'darwin') { // macOS
                playCommand = `afplay "${audioFilePath}"`;
            } else if (platform === 'linux') {
                playCommand = `mpg123 "${audioFilePath}" || aplay "${audioFilePath}" || paplay "${audioFilePath}"`;
            } else if (platform === 'win32') {
                playCommand = `powershell -c "(New-Object Media.SoundPlayer '${audioFilePath}').PlaySync()"`;
            } else {
                throw new Error(`Unsupported platform: ${platform}`);
            }

            // Execute play command
            await execPromise(playCommand);
            
            // Clean up temp file
            setTimeout(() => {
                try {
                    fs.unlinkSync(audioFilePath);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }, 1000);

            consoleStyler.succeedSpinner('tts', 'Speech playback completed');
            return `Text converted to speech and played successfully. Used voice ${voice_id} with ${cleanText.length} characters.`;

        } catch (error) {
            consoleStyler.failSpinner('tts', `Error: ${error.message}`);
            return `Error converting text to speech: ${error.message}`;
        }
    }

    // List custom tools
    async listCustomTools(args) {
        const { category, show_usage = false } = args;
        return await this.customToolsManager.listCustomTools(category, show_usage);
    }

    // Remove custom tool
    async removeCustomTool(args) {
        const { tool_name } = args;
        const result = await this.customToolsManager.removeCustomTool(tool_name);
        return result.message;
    }

    // Export tools
    async exportTools(args) {
        const { output_file, tools: toolsToExport } = args;
        const result = await this.customToolsManager.exportTools(output_file, toolsToExport);
        return result.message;
    }

    // Manage workspace
    async manageWorkspace(args) {
        if (!this.workspaceManager) {
            return "Workspace manager not available";
        }
        
        return await this.workspaceManager.manageWorkspace(args);
    }

    // Structured Development Tools Handlers
    
    async initStructuredDev(args) {
        const targetDir = args.target_dir || null;
        consoleStyler.log('system', `Initializing Structured Development${targetDir ? ` at ${targetDir}` : ''}...`);
        return await this.flowManager.initStructuredDev(targetDir);
    }

    async bootstrapProject(args) {
        const targetDir = args.target_dir || this.manifestManager.workingDir;
        consoleStyler.log('system', `Bootstrapping project at ${targetDir}...`);

        // Create a ManifestManager for the target directory
        const bootstrapManifest = new ManifestManager(targetDir);
        const bootstrapFlow = new FlowManager(bootstrapManifest);
        return await bootstrapFlow.initStructuredDev(targetDir);
    }

    async submitTechnicalDesign(args) {
        const { feature_id, design_doc } = args;
        consoleStyler.log('system', `Submitting technical design for ${feature_id}...`);
        return await this.flowManager.submitTechnicalDesign(feature_id, design_doc);
    }

    async approveDesign(args) {
        const { feature_id, feedback } = args;
        consoleStyler.log('system', `Approving design for ${feature_id}...`);
        return await this.flowManager.approveDesign(feature_id, feedback);
    }

    async lockInterfaces(args) {
        const { feature_id, interface_definitions } = args;
        consoleStyler.log('system', `Locking interfaces for ${feature_id}...`);
        return await this.flowManager.lockInterfaces(feature_id, interface_definitions);
    }

    async submitCritique(args) {
        const { feature_id, critique } = args;
        consoleStyler.log('system', `Submitting critique for ${feature_id}...`);
        return await this.flowManager.submitCritique(feature_id, critique);
    }

    async readManifest(args) {
        consoleStyler.log('system', 'Reading manifest...');
        const content = await this.flowManager.readManifest();
        if (!content) return "No manifest found.";
        return content;
    }

    async visualizeArchitecture(args) {
        consoleStyler.log('system', 'Generating architecture visualization...');
        return await this.flowManager.visualizeArchitecture();
    }

    async rollbackToSnapshot(args) {
        const { snapshot_id } = args;
        if (!snapshot_id) {
            consoleStyler.log('system', 'Listing available snapshots...');
            const snapshots = await this.manifestManager.listSnapshots();
            return `Available Snapshots:\n${snapshots.join('\n')}\n\nUse this tool again with a snapshot_id to restore one.`;
        }
        consoleStyler.log('system', `Rolling back to snapshot: ${snapshot_id}...`);
        return await this.manifestManager.restoreSnapshot(snapshot_id);
    }

    // Create implementation plan
    async createImplementationPlan(args) {
        const { output_file, num_developers = 3 } = args;
        consoleStyler.log('system', `Generating multi-agent implementation plan for ${num_developers} developers...`);
        const result = await this.implementationPlanner.createExecutionPlan(output_file, num_developers);
        
        if (result.success) {
            // Display summary
            consoleStyler.log('system', `✓ Plan created at ${result.plan_path}`, { box: true });
            consoleStyler.log('system', `Stages: ${result.plan.stages.length}`);
            result.plan.stages.forEach(stage => {
                consoleStyler.log('system', `  Stage ${stage.id}: ${stage.tasks.join(', ')}`, { indent: true });
            });
            return result.message;
        } else {
            return `Failed to create plan: ${result.message}`;
        }
    }

    // Execute implementation plan
    async executeImplementationPlan(args) {
        const { plan_file = 'implementation-plan.json' } = args;
        
        // Ensure AI Assistant class is available
        if (!this.planExecutor.AiAssistant) {
             // Fallback: If not passed in constructor, try to use the one from recursive calls
             // This is tricky. Ideally it should be passed in.
             return "Error: AI Assistant class not available for agent execution. This tool requires the system to be initialized with self-replication capabilities.";
        }

        const planPath = path.resolve(this.manifestManager.workingDir, plan_file);
        consoleStyler.log('system', `Executing implementation plan from ${planPath}...`);
        
        const result = await this.planExecutor.executePlan(planPath);
        
        if (result.success) {
            return `Execution completed successfully. ${result.message}`;
        } else {
            return `Execution failed: ${result.message}`;
        }
    }

    // Call AI assistant recursively
    async callAiAssistant(args) {
        const { query, context, recursion_level = 0 } = args;
        
        // Check recursion depth
        const currentLevel = Math.max(this.recursionLevel, recursion_level);
        if (currentLevel >= 3) {
            consoleStyler.log('error', 'Maximum recursion depth reached (3 levels)', { box: true });
            return "Error: Maximum recursion depth (3 levels) reached. Cannot make recursive AI calls.";
        }
        
        if (!this.aiAssistantClass) {
            consoleStyler.log('error', 'AI Assistant class not available for recursive calls');
            return "Error: AI Assistant class not available for recursive calls.";
        }
        
        try {
            consoleStyler.log('ai', `🔄 Initiating recursive AI call (level ${currentLevel + 1})`, { box: true });
            consoleStyler.log('ai', `   Query: ${query.substring(0, 100)}...`, { indent: true });
            consoleStyler.log('ai', `   Context: ${context}`, { indent: true });
            
            // Create new AI assistant instance for recursive call
            const recursiveAssistant = new this.aiAssistantClass(process.cwd());
            await recursiveAssistant.initializeCustomTools();
            
            // Set recursion level in the tool executor
            recursiveAssistant.toolExecutor.recursionLevel = currentLevel + 1;
            
            // Add context to the query
            const contextualQuery = `RECURSIVE CALL (Level ${currentLevel + 1}): ${context}\n\nQuery: ${query}`;
            
            // Execute the recursive call
            const response = await recursiveAssistant.run(contextualQuery);
            
            consoleStyler.log('ai', `✅ Recursive AI call completed (level ${currentLevel + 1})`);
            consoleStyler.log('ai', `   Response length: ${response.length} characters`, { indent: true });
            
            return `Recursive AI Assistant Response:\n\nContext: ${context}\nQuery: ${query}\n\nResponse: ${response}`;
            
        } catch (error) {
            consoleStyler.log('error', `Recursive AI call failed: ${error.message}`, { box: true });
            return `Error in recursive AI call: ${error.message}`;
        }
    }

    // Write file with validation wrapper
    async writeFileWithValidation(args) {
        const { path, content } = args;
        
        // 1. Perform the write
        const writeResult = await this.fileTools.writeFile(args);
        
        // If write failed, return immediately
        if (writeResult.startsWith('Error:')) {
            return writeResult;
        }

        // 2. Perform validation
        // We only validate if we have a validator and it's a code file
        if (this.codeValidator) {
            const validationErrors = await this.codeValidator.validateFile(path);
            
            if (validationErrors) {
                return `${writeResult}\n\n⚠️ Validation Errors Detected:\n${validationErrors}\n\nPlease review and fix these errors in your next step.`;
            } else {
                 return `${writeResult}\n✓ No validation errors detected.`;
            }
        }

        return writeResult;
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

    // Get current todos
    getCurrentTodos() {
        return this.currentTodos;
    }

    // Get error history
    getErrorHistory() {
        return this.errorHistory;
    }

    // Search the web using Serper.dev API
    async searchWeb(args) {
        const {
            query,
            type = 'search',
            num = 10,
            location,
            lang = 'en',
            safe = 'active'
        } = args;

        // Your API key
        const apiKey = process.env.SERPER_API_KEY || '7edbc239394bb9b75ce5543fb6987ba4256b3269';
        
        consoleStyler.log('working', `🔍 Searching web for: "${query}"`);
        consoleStyler.log('working', `   Search type: ${type}, Results: ${num}`, { indent: true });
        
        try {
            const searchParams = {
                q: query,
                type: type,
                num: num,
                lang: lang,
                safe: safe
            };

            // Add location if specified
            if (location) {
                searchParams.location = location;
                consoleStyler.log('working', `   Location: ${location}`, { indent: true });
            }

            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(searchParams)
            });

            if (!response.ok) {
                throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            consoleStyler.log('tools', `✓ Web search completed - found ${data.organic?.length || 0} results`);

            // Format the results
            let formattedResults = `# Web Search Results for: "${query}"\n\n`;
            
            // Add search summary if available
            if (data.searchParameters) {
                formattedResults += `**Search Parameters:**\n`;
                formattedResults += `- Query: ${data.searchParameters.q}\n`;
                formattedResults += `- Type: ${data.searchParameters.type || 'search'}\n`;
                formattedResults += `- Results: ${data.searchParameters.num || 10}\n`;
                if (data.searchParameters.location) {
                    formattedResults += `- Location: ${data.searchParameters.location}\n`;
                }
                formattedResults += `\n`;
            }

            // Add answer box if available
            if (data.answerBox) {
                formattedResults += `## Quick Answer\n`;
                formattedResults += `**${data.answerBox.title || 'Answer'}**\n`;
                formattedResults += `${data.answerBox.answer || data.answerBox.snippet}\n`;
                if (data.answerBox.source) {
                    formattedResults += `*Source: ${data.answerBox.source}*\n`;
                }
                formattedResults += `\n`;
            }

            // Add knowledge graph if available
            if (data.knowledgeGraph) {
                formattedResults += `## Knowledge Graph\n`;
                formattedResults += `**${data.knowledgeGraph.title}**\n`;
                if (data.knowledgeGraph.description) {
                    formattedResults += `${data.knowledgeGraph.description}\n`;
                }
                if (data.knowledgeGraph.source) {
                    formattedResults += `*Source: ${data.knowledgeGraph.source.name}*\n`;
                }
                formattedResults += `\n`;
            }

            // Add organic results
            if (data.organic && data.organic.length > 0) {
                formattedResults += `## Search Results\n\n`;
                
                data.organic.forEach((result, index) => {
                    formattedResults += `### ${index + 1}. ${result.title}\n`;
                    formattedResults += `**URL:** ${result.link}\n`;
                    if (result.snippet) {
                        formattedResults += `**Description:** ${result.snippet}\n`;
                    }
                    if (result.date) {
                        formattedResults += `**Date:** ${result.date}\n`;
                    }
                    formattedResults += `\n`;
                });
            }

            // Add news results if available
            if (data.news && data.news.length > 0) {
                formattedResults += `## Related News\n\n`;
                
                data.news.forEach((news, index) => {
                    formattedResults += `### ${index + 1}. ${news.title}\n`;
                    formattedResults += `**URL:** ${news.link}\n`;
                    if (news.snippet) {
                        formattedResults += `**Description:** ${news.snippet}\n`;
                    }
                    if (news.date) {
                        formattedResults += `**Date:** ${news.date}\n`;
                    }
                    if (news.source) {
                        formattedResults += `**Source:** ${news.source}\n`;
                    }
                    formattedResults += `\n`;
                });
            }

            // Add people also ask if available
            if (data.peopleAlsoAsk && data.peopleAlsoAsk.length > 0) {
                formattedResults += `## People Also Ask\n\n`;
                
                data.peopleAlsoAsk.forEach((question, index) => {
                    formattedResults += `${index + 1}. ${question.question}\n`;
                    if (question.snippet) {
                        formattedResults += `   ${question.snippet}\n`;
                    }
                    formattedResults += `\n`;
                });
            }

            // Add related searches if available
            if (data.relatedSearches && data.relatedSearches.length > 0) {
                formattedResults += `## Related Searches\n\n`;
                
                data.relatedSearches.forEach((search, index) => {
                    formattedResults += `${index + 1}. ${search.query}\n`;
                });
                formattedResults += `\n`;
            }

            return formattedResults;

        } catch (error) {
            consoleStyler.log('error', `Web search failed: ${error.message}`, { box: true });
            return `Error performing web search: ${error.message}`;
        }
    }
}