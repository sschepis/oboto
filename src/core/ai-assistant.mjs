// Main AI Assistant class
// Orchestrates all components and handles the main conversation flow

import { config } from '../config.mjs';
import { TOOLS } from '../tools/tool-definitions.mjs';
import { ReasoningSystem } from '../reasoning/reasoning-system.mjs';
import { CustomToolsManager } from '../custom-tools/custom-tools-manager.mjs';
import { PackageManager } from '../package/package-manager.mjs';
import { ToolExecutor } from '../execution/tool-executor.mjs';
import { WorkspaceManager } from '../workspace/workspace-manager.mjs';
import { QualityEvaluator } from '../quality/quality-evaluator.mjs';
import { HistoryManager } from './history-manager.mjs';
import { createSystemPrompt, enhanceMessagesWithWorkReporting } from './system-prompt.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { ManifestManager } from '../structured-dev/manifest-manager.mjs';
import { callProvider, callProviderStream, getProviderLabel, createProviderContext } from './ai-provider.mjs';

// Use native fetch in Node.js v18+
const fetch = globalThis.fetch;

export class MiniAIAssistant {
    constructor(workingDir, options = {}) {
        // Provider context is auto-detected from model name
        const providerCtx = createProviderContext();
        this.endpoint = providerCtx.endpoint;
        this.workingDir = workingDir || config.system.workspaceRoot || process.cwd();
        
        // Dependency Injection for Adapters
        this.llmAdapter = options.llmAdapter || {
            generateContent: (req) => callProvider(req),
            generateContentStream: (req) => callProviderStream(req)
        };

        // Initialize all subsystems
        this.reasoningSystem = new ReasoningSystem();
        this.customToolsManager = new CustomToolsManager();
        this.packageManager = new PackageManager();
        this.workspaceManager = new WorkspaceManager();
        this.qualityEvaluator = new QualityEvaluator(this.endpoint);
        this.historyManager = new HistoryManager();
        this.manifestManager = new ManifestManager(this.workingDir);
        
        this.toolExecutor = new ToolExecutor(
            this.packageManager,
            this.customToolsManager,
            this.workspaceManager,
            MiniAIAssistant  // Pass the class for recursive calls
        );
        
        // Initialize history with system prompt (will be updated async if manifest exists)
        this.historyManager.initialize(
            createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace())
        );
        
        // Initialize tools with custom tools
        this.allTools = [...TOOLS];
        
        // Model configuration
        this.model = config.ai.model;
        this.temperature = config.ai.temperature;
        
        // Load custom tools will be done asynchronously after construction
        this.customToolsLoaded = false;
    }

    // Initialize custom tools and update system prompt with manifest
    async initializeCustomTools() {
        // Also take this opportunity to ensure system prompt has the latest manifest
        await this.updateSystemPrompt();

        if (this.customToolsLoaded) return;
        const customSchemas = await this.customToolsManager.loadCustomTools();
        this.allTools.push(...customSchemas);
        this.customToolsLoaded = true;
    }

    // Save current session state
    async saveSession(sessionPath) {
        try {
            consoleStyler.log('system', `Saving session to ${sessionPath}...`);
            const historySaved = await this.historyManager.save(`${sessionPath}.history.json`);
            
            // Only save workspace if active
            if (this.workspaceManager.isWorkspaceActive()) {
                await this.workspaceManager.save(`${sessionPath}.workspace.json`);
            }
            
            if (historySaved) {
                consoleStyler.log('system', `✓ Session saved successfully`);
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to save session: ${error.message}`);
            return false;
        }
    }

    // Load session state
    async loadSession(sessionPath) {
        try {
            consoleStyler.log('system', `Loading session from ${sessionPath}...`);
            const historyLoaded = await this.historyManager.load(`${sessionPath}.history.json`);
            
            // Try to load workspace
            await this.workspaceManager.load(`${sessionPath}.workspace.json`);
            
            if (historyLoaded) {
                consoleStyler.log('system', `✓ Session loaded successfully (${this.historyManager.getHistory().length} messages)`);
                // Update system prompt with current environment
                this.updateSystemPrompt();
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to load session: ${error.message}`);
            return false;
        }
    }

    // Delete specified number of exchanges from history
    deleteHistoryExchanges(count) {
        const deletedExchanges = this.historyManager.deleteHistoryExchanges(count);
        
        // Reset any conversation state that depends on history length
        if (deletedExchanges > 0) {
            this.qualityEvaluator.reset();
        }
        
        return deletedExchanges;
    }

    // Main function to process user input and orchestrate tool use
    async run(userInput, isRetry = false) {
        // Ensure custom tools are loaded
        await this.initializeCustomTools();
        
        if (!isRetry) {
            consoleStyler.log('ai', 'Processing new user request...', { timestamp: true });
            this.historyManager.addMessage('user', userInput);
            this.qualityEvaluator.reset();
            this.reasoningSystem.reset();
            
            // Predict reasoning from input
            consoleStyler.log('reasoning', 'Analyzing request complexity and predicting reasoning approach...');
            this.reasoningSystem.predictReasoningFromInput(userInput);
        } else {
            consoleStyler.log('recovery', `Retry attempt #${this.qualityEvaluator.getRetryAttempts()} initiated`, { timestamp: true });
        }
        
        let finalResponse = null;
        const maxTurns = 30; // Maximum conversation turns (increased for complex tasks)

        for (let i = 0; i < maxTurns; i++) {
            // Show conversation turn progress
            consoleStyler.log('progress', `Processing turn ${i + 1}/${maxTurns}`, { timestamp: true });
            
            const responseMessage = await this.generateContent();

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                // Log tool calls initiation
                const toolNames = responseMessage.tool_calls.map(tc => tc.function.name).join(', ');
                consoleStyler.log('tools', `Initiating ${responseMessage.tool_calls.length} tool call(s): ${toolNames}`);
                
                this.historyManager.pushMessage(responseMessage);
                
                for (const toolCall of responseMessage.tool_calls) {
                    // Log individual tool execution start
                    consoleStyler.log('working', `Executing tool: ${toolCall.function.name}`);
                    
                    // Handle tool-specific reasoning updates
                    if (toolCall.function.name === 'embellish_request') {
                        const args = JSON.parse(toolCall.function.arguments);
                        if (args.reasoning_effort && args.reasoning_justification) {
                            consoleStyler.log('reasoning', `Embellishing request with ${args.reasoning_effort} reasoning`);
                            this.reasoningSystem.setPredictedReasoning(
                                args.reasoning_effort,
                                args.reasoning_justification
                            );
                        }
                    }
                    
                    const toolResult = await this.toolExecutor.executeTool(toolCall);
                    
                    // Log tool completion
                    const success = !toolResult.content.startsWith('Error:');
                    if (success) {
                        consoleStyler.log('tools', `✓ Tool completed: ${toolCall.function.name}`);
                    } else {
                        consoleStyler.log('error', `✗ Tool failed: ${toolCall.function.name} - ${toolResult.content.substring(0, 50)}...`);
                    }
                    
                    this.historyManager.pushMessage(toolResult);
                }
                
                consoleStyler.log('tools', `All tool calls completed. Continuing conversation...`);
                continue;

            } else {
                finalResponse = responseMessage.content;
                
                // Check for workPerformed field and display as intermediate update
                if (responseMessage.workPerformed) {
                    consoleStyler.log('workCompleted', responseMessage.workPerformed);
                }
                
                this.historyManager.addMessage('assistant', finalResponse);
                
                // Perform quality evaluation if this isn't already a retry
                if (!isRetry && !this.qualityEvaluator.isRetrying()) {
                    consoleStyler.log('quality', 'Initiating response quality evaluation...', { timestamp: true });
                    
                    const qualityResult = await this.performQualityEvaluation(userInput, finalResponse);
                    
                    if (qualityResult) {
                        const rating = qualityResult.rating !== undefined ? qualityResult.rating : 0;
                        consoleStyler.log('quality', `Quality evaluation complete: ${rating}/10`);
                        
                        if (this.qualityEvaluator.shouldRetry(qualityResult)) {
                            consoleStyler.log('quality', `Quality below threshold (${rating}/10). Initiating retry...`, { box: true });
                            consoleStyler.log('quality', `Remedy: ${qualityResult.remedy}`);
                            
                            const improvedPrompt = this.qualityEvaluator.createRetryPrompt(
                                userInput,
                                finalResponse,
                                qualityResult
                            );
                            
                            // Preserve tool call history but reset conversation for retry
                            const systemPrompt = {
                                role: 'system',
                                content: createSystemPrompt(this.workingDir, this.workspaceManager.getCurrentWorkspace())
                            };
                            
                            // Keep all tool calls and results, but remove the final poor-quality response
                            const history = this.historyManager.getHistory();
                            const preservedHistory = history.filter(msg =>
                                msg.role === 'system' ||
                                msg.role === 'tool' ||
                                (msg.role === 'assistant' && msg.tool_calls) ||
                                msg.role === 'user'
                            );
                            
                            // Update system prompt and preserve session memory
                            this.historyManager.setHistory([systemPrompt, ...preservedHistory.slice(1)]);
                            
                            consoleStyler.log('recovery', 'Preserving tool call history and retrying with improved prompt...');
                            const stats = this.historyManager.getStats();
                            consoleStyler.log('recovery', `Session memory preserved: ${stats.messageCount} messages`, { indent: true });
                            
                            // Recursive retry with improved prompt
                            return await this.run(improvedPrompt, true);
                        } else {
                            consoleStyler.log('quality', `✓ Response quality approved (${rating}/10)`);
                        }
                    } else {
                        consoleStyler.log('quality', 'Quality evaluation skipped or failed');
                    }
                }
                
                break;
            }
        }

        if (!finalResponse) {
            finalResponse = "The assistant could not determine a final answer after multiple steps.";
        }
        
        return finalResponse;
    }

    // Perform quality evaluation on the response
    async performQualityEvaluation(userInput, finalResponse) {
        const history = this.historyManager.getHistory();
        const toolCallsSummary = this.qualityEvaluator.extractToolCallsSummary(history);
        const toolResults = this.qualityEvaluator.extractToolResults(history);
        
        return await this.qualityEvaluator.evaluateResponse(
            userInput,
            finalResponse,
            toolCallsSummary,
            toolResults,
            createSystemPrompt,
            this.workingDir,
            this.workspaceManager.getCurrentWorkspace()
        );
    }

    // Function to call the AI provider using the injected adapter
    async generateContent(overrideReasoning = null, toolName = null) {
        // Determine reasoning effort
        let reasoning = overrideReasoning;
        
        if (!reasoning) {
            const history = this.historyManager.getHistory();
            const context = {
                retryAttempts: this.qualityEvaluator.getRetryAttempts(),
                historyLength: history.length,
                toolCallCount: history.filter(msg => msg.tool_calls).length,
                pendingSteps: this.toolExecutor.getCurrentTodos()?.items?.filter(
                    item => item.status !== 'completed'
                ).length || 0,
                todoCount: this.toolExecutor.getCurrentTodos()?.items?.length || 0,
                toolName
            };
            
            reasoning = this.reasoningSystem.getSimplifiedReasoning('', context);
            consoleStyler.log('reasoning', `Selected reasoning effort: ${reasoning}`);
        }
        
        try {
            const providerLabel = getProviderLabel(this.model);
            consoleStyler.log('ai', `Sending request to ${providerLabel}...`, { timestamp: true });
            const stats = this.historyManager.getStats();
            consoleStyler.log('ai', `Session context: ${stats.messageCount} messages, ~${stats.estimatedTokens} tokens`, { indent: true });
            
            // Add specific instruction for workPerformed field
            const enhancedHistory = enhanceMessagesWithWorkReporting([...this.historyManager.getHistory()]);
            
            // Use the injected LLM adapter
            const result = await this.llmAdapter.generateContent({
                model: this.model,
                messages: enhancedHistory,
                tools: this.allTools,
                tool_choice: "auto",
                temperature: this.temperature,
                reasoning_effort: reasoning
            });

            if (!result.choices || result.choices.length === 0) {
                throw new Error("Invalid response structure from AI provider.");
            }
            
            const message = result.choices[0].message;
            
            // Try to extract workPerformed from the response content if it's structured
            if (message.content && typeof message.content === 'string') {
                // Try to parse as JSON first
                try {
                    const jsonMatch = message.content.match(/^\s*\{[\s\S]*\}\s*$/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(message.content);
                        if (parsed.workPerformed) {
                            message.workPerformed = parsed.workPerformed;
                        }
                    }
                } catch (e) {
                    // Not valid JSON, try regex extraction
                }
                
                // Fallback to regex for markdown or text formats
                if (!message.workPerformed) {
                    const workPerformedMatch = message.content.match(/\*?\*?workPerformed\*?\*?[:\s]+([^*\n]+?)(?:\*\*|\n|$)/i);
                    if (workPerformedMatch) {
                        message.workPerformed = workPerformedMatch[1].trim();
                    }
                }
            }
            
            return message;

        } catch (error) {
            consoleStyler.log('error', `AI provider communication failed: ${error.message}`, { box: true });
            
            // Track errors for reasoning system
            this.reasoningSystem.addError(error);
            
            // If it's a fetch error, try to continue with a recovery message
            if (error.message.includes('fetch failed') || error.message.includes('Error:')) {
                consoleStyler.log('recovery', 'API connection failed, attempting to continue task execution');
                return {
                    content: "API connection temporarily failed. Continuing with task execution.",
                    tool_calls: []
                };
            }
            
            return { content: `Error: ${error.message}.` };
        }
    }

    // Function to call the AI provider with streaming response.
    async runStream(userInput, onChunk) {
        // Ensure custom tools are loaded
        await this.initializeCustomTools();

        this.historyManager.addMessage('user', userInput);
        this.qualityEvaluator.reset();
        this.reasoningSystem.reset();

        // Predict reasoning from input
        this.reasoningSystem.predictReasoningFromInput(userInput);

        let reasoning = this.reasoningSystem.getSimplifiedReasoning('', {});
        const maxTurns = 30; // Maximum conversation turns (increased for complex tasks)

        try {
            for (let i = 0; i < maxTurns; i++) {
                consoleStyler.log('progress', `Processing turn ${i + 1}/${maxTurns}`, { timestamp: true });

                const enhancedHistory = enhanceMessagesWithWorkReporting([...this.historyManager.getHistory()]);

                // Use the injected LLM adapter
                // Note: We use generateContent (non-streaming) for tool logic usually, 
                // but if the adapter supports proper streaming for non-tool responses we could use it.
                // The original code used callProvider (non-streaming) even in runStream for the loop logic,
                // only sending the final text via onChunk.
                // We will stick to that logic to ensure tool calls work.
                
                const result = await this.llmAdapter.generateContent({
                    model: this.model,
                    messages: enhancedHistory,
                    tools: this.allTools,
                    tool_choice: "auto",
                    temperature: this.temperature,
                    reasoning_effort: reasoning,
                });

                if (!result.choices || result.choices.length === 0) {
                    const fallback = "Invalid response from AI provider.";
                    onChunk(fallback);
                    return fallback;
                }

                const message = result.choices[0].message;

                if (message.tool_calls && message.tool_calls.length > 0) {
                    // Handle tool calls (same loop as run())
                    const toolNames = message.tool_calls.map(tc => tc.function.name).join(', ');
                    consoleStyler.log('tools', `Executing tool(s): ${toolNames}`);

                    this.historyManager.pushMessage(message);

                    for (const toolCall of message.tool_calls) {
                        consoleStyler.log('working', `Executing: ${toolCall.function.name}`);

                        // Handle embellish_request reasoning updates
                        if (toolCall.function.name === 'embellish_request') {
                            try {
                                const args = JSON.parse(toolCall.function.arguments);
                                if (args.reasoning_effort && args.reasoning_justification) {
                                    this.reasoningSystem.setPredictedReasoning(
                                        args.reasoning_effort,
                                        args.reasoning_justification
                                    );
                                }
                            } catch (e) { /* ignore parse errors */ }
                        }

                        const toolResult = await this.toolExecutor.executeTool(toolCall);
                        const success = !toolResult.content.startsWith('Error:');
                        if (success) {
                            consoleStyler.log('tools', `✓ ${toolCall.function.name}`);
                        } else {
                            consoleStyler.log('error', `✗ ${toolCall.function.name} - ${toolResult.content.substring(0, 80)}...`);
                        }
                        this.historyManager.pushMessage(toolResult);
                    }
                    consoleStyler.log('tools', 'All tool calls completed. Continuing...');
                    continue;
                } else {
                    // Final text response — send to callback
                    const content = message.content || '';
                    onChunk(content);
                    this.historyManager.addMessage('assistant', content);
                    return content;
                }
            }

            const fallback = "Could not determine a response after multiple turns.";
            onChunk(fallback);
            return fallback;

        } catch (error) {
             consoleStyler.log('error', `Request failed: ${error.message}`);
             const errMsg = `Error: ${error.message}`;
             onChunk(errMsg);
             return errMsg;
        }
    }

    // Update system prompt with current workspace and manifest
    async updateSystemPrompt() {
        let manifestContent = null;
        if (this.manifestManager && this.manifestManager.hasManifest()) {
            manifestContent = await this.manifestManager.readManifest();
        }

        this.historyManager.updateSystemPrompt(
            createSystemPrompt(
                this.workingDir,
                this.workspaceManager.getCurrentWorkspace(),
                manifestContent
            )
        );
    }

    // Get current conversation context
    getContext() {
        return {
            historyLength: this.historyManager.getHistory().length,
            workspace: this.workspaceManager.getCurrentWorkspace(),
            currentTodos: this.toolExecutor.getCurrentTodos(),
            qualityIssue: this.qualityEvaluator.getQualityIssue(),
            retryAttempts: this.qualityEvaluator.getRetryAttempts(),
            errorHistory: this.toolExecutor.getErrorHistory()
        };
    }

    // Debug: Display current session memory state
    displaySessionMemory() {
        const history = this.historyManager.getHistory();
        const sessionSummary = {
            totalMessages: history.length,
            messageTypes: {
                system: history.filter(m => m.role === 'system').length,
                user: history.filter(m => m.role === 'user').length,
                assistant: history.filter(m => m.role === 'assistant').length,
                tool: history.filter(m => m.role === 'tool').length
            },
            toolResults: history.filter(m => m.role === 'tool').map(m => ({
                name: m.name,
                contentLength: m.content.length
            })),
            assistantWithToolCalls: history.filter(m => m.role === 'assistant' && m.tool_calls).length
        };

        consoleStyler.log('system', 'Session Memory State:', { box: true });
        consoleStyler.log('system', `Total messages: ${sessionSummary.totalMessages}`, { indent: true });
        consoleStyler.log('system', `Message breakdown: ${JSON.stringify(sessionSummary.messageTypes)}`, { indent: true });
        consoleStyler.log('system', `Tool results: ${sessionSummary.toolResults.length} preserved`, { indent: true });
        
        if (sessionSummary.toolResults.length > 0) {
            sessionSummary.toolResults.forEach((tool, i) => {
                consoleStyler.log('system', `  ${i + 1}. ${tool.name} (${tool.contentLength} chars)`, { indent: true });
            });
        }

        return sessionSummary;
    }
}
