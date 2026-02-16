// Main entry point for the AI Assistant
// Orchestrates CLI interface and AI assistant initialization

import { MiniAIAssistant } from './core/ai-assistant.mjs';
import { CLIInterface } from './cli/cli-interface.mjs';

// Main execution function
async function main() {
    const cli = new CLIInterface();
    
    try {
        // Set up signal handlers for graceful shutdown
        cli.setupSignalHandlers();
        
        // Parse command line arguments
        const { args, workingDir, isInteractive, userInput, resume } = cli.parseArguments();
        
        // Display startup information
        cli.displayStartupInfo(workingDir);
        
        // Initialize AI assistant
        const assistant = new MiniAIAssistant(workingDir);
        
        // Load custom tools before starting
        await assistant.initializeCustomTools();

        // Resume session if requested
        if (resume) {
            await assistant.loadSession('.ai-session');
        }
        
        if (isInteractive) {
            // Interactive mode
            await cli.startInteractiveMode(assistant, workingDir);
        } else {
            // Single-shot mode
            await cli.runSingleShot(assistant, userInput, workingDir);
        }
        
    } catch (error) {
        cli.displayError(error);
        process.exit(1);
    } finally {
        cli.close();
    }
}

// Handle module execution
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => {
        // Import consoleStyler for error display
        import('./ui/console-styler.mjs').then(({ consoleStyler }) => {
            consoleStyler.log('error', `An unexpected error occurred: ${err.message}`);
        }).catch(() => {
            console.error("\x1b[31mAn unexpected error occurred:\x1b[0m", err);
        });
        process.exit(1);
    });
}

export { main };