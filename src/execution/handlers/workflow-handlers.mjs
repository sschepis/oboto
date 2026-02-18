import { consoleStyler } from '../../ui/console-styler.mjs';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export class WorkflowHandlers {
    constructor() {
        this.currentTodos = null;
        this.errorHistory = [];
    }

    getCurrentTodos() {
        return this.currentTodos;
    }

    getErrorHistory() {
        return this.errorHistory;
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
    async analyzeAndRecover(args, packageManager) {
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
                        await packageManager.setupCommonJSRequire();
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
}
