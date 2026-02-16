// CLI interface logic
// Handles command-line interaction and user input processing

import readline from 'readline';
import { consoleStyler } from '../ui/console-styler.mjs';

export class CLIInterface {
    constructor() {
        this.rl = null;
    }

    // Start interactive mode with simple approach
    // Returns a Promise that resolves only when the user types "exit"
    async startInteractiveMode(assistant, workingDir) {
        consoleStyler.log('system', 'AI Assistant (Interactive Mode). Type "exit" to quit.');
        consoleStyler.log('system', `Working Directory: ${workingDir}`);
        
        // Create readline with minimal config
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        // Return a promise that stays pending until exit
        return new Promise((resolve) => {
            // Simple recursive prompt
            const prompt = () => {
                this.rl.question('👤 [YOU] ', async (userInput) => {
                    if (!userInput || userInput.trim() === '') {
                        prompt();
                        return;
                    }
                    
                    if (userInput.toLowerCase() === 'exit') {
                        consoleStyler.log('system', 'Goodbye!', { box: true });
                        // Save session on exit
                        await assistant.saveSession('.ai-session');
                        resolve(); // Resolve the promise so main() can clean up
                        return;
                    }
                    
                    // Handle backslash commands for history deletion
                    if (userInput.match(/^\\+$/)) {
                        const backslashCount = userInput.length;
                        const deletedCount = assistant.deleteHistoryExchanges(backslashCount);
                        consoleStyler.log('history', `Deleted ${deletedCount} exchange(s) from history.`);
                        prompt();
                        return;
                    }
                    
                    try {
                        // Using streaming if available
                        if (assistant.runStream) {
                            consoleStyler.log('working', 'Thinking...');
                            // No spinner for streaming to avoid clearing/redrawing issues
                            await assistant.runStream(userInput, (chunk) => {
                                 process.stdout.write(chunk);
                            });
                            console.log('\n'); // Newline after stream
                        } else {
                            const spinner = consoleStyler.startSpinner('processing', 'Processing your request...');
                            const response = await assistant.run(userInput);
                            consoleStyler.succeedSpinner('processing', 'Request processed');
                            consoleStyler.log('ai', response);
                        }
                    } catch (error) {
                        consoleStyler.failSpinner('processing', 'Request failed');
                        consoleStyler.log('error', error.message);
                    }
                    
                    prompt(); // Continue prompting
                });
            };
            
            // Handle stdin close (e.g., piped input, Ctrl+D)
            this.rl.on('close', () => {
                resolve();
            });
            
            // Start prompting
            prompt();
        });
    }

    // Run single-shot mode
    async runSingleShot(assistant, userInput, workingDir) {
        consoleStyler.log('user', userInput);
        consoleStyler.log('system', `Working Directory: ${workingDir}`);
        
        try {
            const spinner = consoleStyler.startSpinner('processing', 'Processing your request...');
            const response = await assistant.run(userInput);
            consoleStyler.succeedSpinner('processing', 'Request completed');
            consoleStyler.log('ai', response);
        } catch (error) {
            consoleStyler.failSpinner('processing', 'Request failed');
            const errorDisplay = consoleStyler.formatError(error, {
                suggestions: [
                    'Check your AI provider is configured correctly (see .env.example)',
                    'For local: ensure LMStudio/Ollama is running on the configured port',
                    'For cloud: verify your API key (OPENAI_API_KEY or GOOGLE_API_KEY)',
                    'Try restarting the application'
                ]
            });
            console.log(errorDisplay);
            process.exit(1);
        }
        
        // Force exit after a short delay to ensure all output is flushed
        setTimeout(() => {
            process.exit(0);
        }, 100);
    }

    // Parse command line arguments
    parseArguments() {
        const args = process.argv.slice(2);
        const workingDir = process.cwd();
        
        // Check for flags
        const resumeIndex = args.indexOf('--resume');
        const resume = resumeIndex !== -1;
        
        // Remove flags from args
        if (resume) {
            args.splice(resumeIndex, 1);
        }

        return {
            args,
            workingDir,
            resume,
            isInteractive: args.length === 0,
            userInput: args.length > 0 ? args.join(' ') : null
        };
    }

    // Display startup information
    displayStartupInfo(workingDir) {
        consoleStyler.displayStartupBanner(workingDir);
    }

    // Display help information
    displayHelp() {
        const theme = consoleStyler.getTheme();
        const helpContent = `
${consoleStyler.icons.ai} AI Assistant Help:

${theme.primary('USAGE:')}
  Interactive mode: node ai.mjs
  Single-shot mode: node ai.mjs "your question or command"

${theme.warning('SPECIAL COMMANDS (Interactive mode only):')}
  \\         - Delete the last exchange from conversation history
  \\\\        - Delete the last 2 exchanges from conversation history
  \\\\\\       - Delete the last 3 exchanges from conversation history
  exit      - Exit the program

${theme.info('EXAMPLES:')}
  node ai.mjs "Create a simple calculator function"
  node ai.mjs "Use axios to fetch data from jsonplaceholder.typicode.com"
  node ai.mjs "Install and use uuid to generate 5 random IDs"

${theme.success('FEATURES:')}
  ${consoleStyler.icons.check} Execute JavaScript code with automatic npm package installation
  ${consoleStyler.icons.check} Create and manage custom reusable tools
  ${consoleStyler.icons.check} Multi-step task management with todo lists
  ${consoleStyler.icons.check} Error recovery and retry mechanisms
  ${consoleStyler.icons.check} Quality evaluation and response improvement
  ${consoleStyler.icons.check} Workspace management for complex tasks
  ${consoleStyler.icons.check} Text-to-speech support (with ElevenLabs API key)
  ${consoleStyler.icons.check} Enhanced console styling with themes

${theme.system('REQUIREMENTS:')}
  ${consoleStyler.icons.bullet} Node.js v18+ (for native fetch support)
  ${consoleStyler.icons.bullet} One of: LMStudio/Ollama (local), OpenAI API key, or Google Gemini API key
  ${consoleStyler.icons.bullet} Set AI_MODEL in .env (e.g., gpt-4o, gemini-2.0-flash, or local model name)
  ${consoleStyler.icons.bullet} Optional: ElevenLabs API key for text-to-speech

${theme.accent('THEMES:')}
  Available: ${consoleStyler.getAvailableThemes().join(', ')}
  Current: ${consoleStyler.currentTheme}
`;

        console.log(helpContent);
    }

    // Display error information
    displayError(error) {
        const suggestions = [];
        
        if (error.code === 'ECONNREFUSED') {
            suggestions.push(
                'For local: start LMStudio/Ollama and load a model with function calling support',
                'For cloud: set AI_MODEL and API key in .env (e.g., gemini-2.0-flash + GOOGLE_API_KEY)',
                'Check your network connection'
            );
        }
        
        const errorDisplay = consoleStyler.formatError(error, { suggestions });
        console.log(errorDisplay);
    }

    // Handle process signals for graceful shutdown
    setupSignalHandlers() {
        process.on('SIGINT', () => {
            consoleStyler.clearAllSpinners();
            consoleStyler.log('system', 'Received SIGINT, shutting down gracefully...', { box: true });
            if (this.rl) {
                this.rl.close();
            }
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            consoleStyler.clearAllSpinners();
            consoleStyler.log('system', 'Received SIGTERM, shutting down gracefully...', { box: true });
            if (this.rl) {
                this.rl.close();
            }
            process.exit(0);
        });

        process.on('uncaughtException', (error) => {
            consoleStyler.clearAllSpinners();
            consoleStyler.log('error', `UNCAUGHT EXCEPTION: ${error.message}`);
            this.displayError(error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            consoleStyler.clearAllSpinners();
            consoleStyler.log('error', `UNHANDLED REJECTION: ${reason}`);
            console.error('At promise:', promise);
            process.exit(1);
        });
    }

    // Close the CLI interface
    close() {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
    }

    // Display a message with color coding
    displayMessage(message, type = 'info') {
        consoleStyler.log(type, message);
    }

    // Display progress indicator
    displayProgress(message) {
        consoleStyler.startSpinner('progress', message);
    }

    // Clear progress indicator
    clearProgress() {
        consoleStyler.succeedSpinner('progress', 'Done');
    }

    // Set console theme
    setTheme(themeName) {
        return consoleStyler.setTheme(themeName);
    }

    // Get available themes
    getAvailableThemes() {
        return consoleStyler.getAvailableThemes();
    }
}