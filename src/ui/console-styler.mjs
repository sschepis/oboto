// Enhanced Console Styling System
// Provides modern, themed terminal output with gradients, icons, and animations

import chalk from 'chalk';
import gradient from 'gradient-string';
import boxen from 'boxen';
import ora from 'ora';
import figures from 'figures';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export class ConsoleStyler {
    constructor(theme = 'cyberpunk') {
        this.currentTheme = theme;
        this.themes = this.initializeThemes();
        this.icons = this.initializeIcons();
        this.spinners = new Map(); // Track active spinners
        this.listener = null; // Listener for redirecting output
    }

    // Set a listener to capture logs instead of printing to console
    setListener(listener) {
        this.listener = listener;
    }

    // Initialize color themes
    initializeThemes() {
        // Default themes
        let themes = {};
        
        // Try to load themes from external file
        try {
            const __filename = fileURLToPath(import.meta.url);
            const scriptDir = path.dirname(path.dirname(path.dirname(__filename)));
            const themesPath = path.join(scriptDir, 'themes.json');
            
            if (fs.existsSync(themesPath)) {
                const loadedThemes = JSON.parse(fs.readFileSync(themesPath, 'utf8'));
                
                // Convert arrays of colors to gradient functions
                for (const [name, colors] of Object.entries(loadedThemes)) {
                    themes[name] = {};
                    for (const [type, colorArray] of Object.entries(colors)) {
                        themes[name][type] = gradient(colorArray);
                    }
                }
            }
        } catch (error) {
            // Fallback if file load fails
            console.error('Failed to load themes.json:', error.message);
        }
        
        // Ensure at least one default theme exists if loading failed
        if (Object.keys(themes).length === 0) {
            themes.cyberpunk = {
                primary: gradient(['#ff0080', '#7928ca', '#0070f3']),
                secondary: gradient(['#00d4ff', '#0070f3']),
                success: gradient(['#00ff88', '#00d4aa']),
                warning: gradient(['#ffaa00', '#ff6b35']),
                error: gradient(['#ff4757', '#c44569']),
                info: gradient(['#5352ed', '#3742fa']),
                system: gradient(['#747d8c', '#57606f']),
                accent: gradient(['#ffa502', '#ff6348']),
                todo: gradient(['#ff6b9d', '#c44569']),
                workspace: gradient(['#6c5ce7', '#a29bfe']),
                tools: gradient(['#00cec9', '#00b894']),
                reasoning: gradient(['#fd79a8', '#e84393']),
                quality: gradient(['#fdcb6e', '#e17055']),
                progress: gradient(['#74b9ff', '#0984e3'])
            };
        }

        return themes;
    }

    // Initialize icons for different message types
    initializeIcons() {
        return {
            user: '👤',
            ai: '🤖',
            error: '❌',
            warning: '⚠️',
            success: '✅',
            info: 'ℹ️',
            system: '⚙️',
            tools: '🔧',
            todo: '📋',
            workspace: '🏠',
            working: '⚡',
            recovery: '🔄',
            quality: '🎯',
            tts: '🔊',
            reasoning: '🧠',
            history: '📚',
            packages: '📦',
            progress: '⏳',
            workCompleted: '✨',
            custom: '🛠️',
            loading: '⟳',
            status: '📡',
            check: figures.tick,
            cross: figures.cross,
            bullet: figures.bullet,
            arrow: figures.arrowRight,
            star: figures.star,
            heart: figures.heart,
            radioOn: figures.radioOn,
            radioOff: figures.radioOff
        };
    }

    // Set theme
    setTheme(themeName) {
        if (this.themes[themeName]) {
            this.currentTheme = themeName;
            return true;
        }
        return false;
    }

    // Get current theme colors
    getTheme() {
        return this.themes[this.currentTheme] || Object.values(this.themes)[0];
    }

    // Enhanced startup banner
    displayStartupBanner(workingDir) {
        const theme = this.getTheme();
        const banner = `
     ██████╗ ██████╗  ██████╗ ████████╗ ██████╗ 
    ██╔═══██╗██╔══██╗██╔═══██╗╚══██╔══╝██╔═══██╗
    ██║   ██║██████╔╝██║   ██║   ██║   ██║   ██║
    ██║   ██║██╔══██╗██║   ██║   ██║   ██║   ██║
    ╚██████╔╝██████╔╝╚██████╔╝   ██║   ╚██████╔╝
     ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝    ╚═════╝ 
          your ai-powered everything assistant
    `;

        const styledBanner = theme.primary(banner);
        
        const infoBox = boxen(
            `${this.icons.system}  Working Directory: ${chalk.cyan(workingDir)}\n` +
            `${this.icons.ai} Theme: ${chalk.magenta(this.currentTheme)}`,
            {
                padding: 0,
                margin: 1,
                borderStyle: 'none',
                borderColor: 'cyan',
                backgroundColor: 'black'
            }
        );
        console.clear();
        console.log(styledBanner);
        console.log(infoBox);
        console.log(theme.accent('═'.repeat(80)));
    }

    // Enhanced message formatting
    formatMessage(type, content, options = {}) {
        const theme = this.getTheme();
        const icon = this.icons[type] || this.icons.info;
        const timestamp = options.timestamp ? chalk.gray(`[${new Date().toLocaleTimeString()}] `) : '';
        
        let colorFunc;
        let label = '';

        switch (type) {
            case 'user':
                colorFunc = theme.info;
                label = 'YOU';
                break;
            case 'ai':
                colorFunc = theme.success;
                label = 'AI';
                break;
            case 'error':
                colorFunc = theme.error;
                label = 'ERROR';
                break;
            case 'warning':
                colorFunc = theme.warning;
                label = 'WARNING';
                break;
            case 'system':
                colorFunc = theme.system;
                label = 'SYSTEM';
                break;
            case 'tools':
                colorFunc = theme.tools;
                label = 'TOOLS';
                break;
            case 'todo':
                colorFunc = theme.todo;
                label = 'TODO';
                break;
            case 'workspace':
                colorFunc = theme.workspace;
                label = 'WORKSPACE';
                break;
            case 'working':
                colorFunc = theme.accent;
                label = 'WORKING';
                break;
            case 'recovery':
                colorFunc = theme.error;
                label = 'RECOVERY';
                break;
            case 'quality':
                colorFunc = theme.quality;
                label = 'QUALITY';
                break;
            case 'tts':
                colorFunc = theme.info;
                label = 'TTS';
                break;
            case 'reasoning':
                colorFunc = theme.reasoning;
                label = 'REASONING';
                break;
            case 'history':
                colorFunc = theme.warning;
                label = 'HISTORY';
                break;
            case 'packages':
                colorFunc = theme.tools;
                label = 'PACKAGES';
                break;
            case 'progress':
                colorFunc = theme.progress;
                label = 'PROGRESS';
                break;
            case 'workCompleted':
                colorFunc = theme.success;
                label = 'WORK COMPLETED';
                break;
            case 'status':
                colorFunc = theme.primary;
                label = 'STATUS';
                break;
            case 'custom':
                colorFunc = theme.accent;
                label = 'CUSTOM';
                break;
            default:
                colorFunc = theme.info;
                label = type.toUpperCase();
        }

        const styledLabel = colorFunc(`[${label}]`);
        const formattedContent = options.indent ? `    ${content}` : content;
        
        if (options.box) {
            return boxen(
                `${icon} ${formattedContent}`,
                {
                    padding: 1,
                    borderStyle: 'round',
                    borderColor: this.getBoxColor(type)
                }
            );
        }

        return `${timestamp}${icon} ${styledLabel} ${formattedContent}`;
    }

    // Get appropriate box color for message type
    getBoxColor(type) {
        const colorMap = {
            error: 'red',
            warning: 'yellow',
            success: 'green',
            info: 'blue',
            system: 'gray',
            tools: 'cyan',
            todo: 'magenta',
            workspace: 'blue',
            quality: 'yellow'
        };
        return colorMap[type] || 'cyan';
    }

    // Enhanced progress display with spinners
    createSpinner(text, type = 'dots') {
        const theme = this.getTheme();
        const spinner = ora({
            text: theme.progress(text),
            spinner: type,
            color: 'cyan'
        });
        return spinner;
    }

    // Start a named spinner
    startSpinner(name, text, type = 'dots') {
        const spinner = this.createSpinner(text, type);
        this.spinners.set(name, spinner);
        spinner.start();
        return spinner;
    }

    // Update spinner text
    updateSpinner(name, text) {
        const spinner = this.spinners.get(name);
        if (spinner) {
            const theme = this.getTheme();
            spinner.text = theme.progress(text);
        }
    }

    // Stop spinner with success
    succeedSpinner(name, text) {
        const spinner = this.spinners.get(name);
        if (spinner) {
            const theme = this.getTheme();
            spinner.succeed(theme.success(text));
            this.spinners.delete(name);
        }
    }

    // Stop spinner with failure
    failSpinner(name, text) {
        const spinner = this.spinners.get(name);
        if (spinner) {
            const theme = this.getTheme();
            spinner.fail(theme.error(text));
            this.spinners.delete(name);
        }
    }

    // Enhanced todo list display
    formatTodoList(todoData) {
        const theme = this.getTheme();
        const { task, items } = todoData;
        
        let output = boxen(
            theme.todo(`${this.icons.todo} Task: ${task}`),
            {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'magenta'
            }
        );

        output += '\n\n';

        items.forEach((item, index) => {
            const number = chalk.gray(`${index + 1}.`);
            let statusIcon;
            let statusColor;

            switch (item.status) {
                case 'completed':
                    statusIcon = this.icons.check;
                    statusColor = theme.success;
                    break;
                case 'in_progress':
                    statusIcon = this.icons.arrow;
                    statusColor = theme.warning;
                    break;
                default:
                    statusIcon = this.icons.radioOff;
                    statusColor = theme.system;
            }

            const statusText = statusColor(`${statusIcon} ${item.step}`);
            const result = item.result ? chalk.gray(` - ${item.result}`) : '';
            
            output += `${number} ${statusText}${result}\n`;
        });

        return output;
    }

    // Enhanced error display
    formatError(error, context = {}) {
        const theme = this.getTheme();
        const errorBox = boxen(
            `${this.icons.error} ${theme.error('ERROR')}\n\n` +
            `${chalk.red(error.message)}\n` +
            (error.code ? `\nCode: ${chalk.yellow(error.code)}` : '') +
            (context.suggestions ? `\n\n${this.icons.info} Suggestions:\n${context.suggestions.map(s => `  • ${s}`).join('\n')}` : ''),
            {
                padding: 1,
                borderStyle: 'double',
                borderColor: 'red',
                backgroundColor: 'black'
            }
        );

        return errorBox;
    }

    // Progress bar for long operations
    createProgressBar(total, current = 0) {
        const theme = this.getTheme();
        const percentage = Math.round((current / total) * 100);
        const barLength = 30;
        const filledLength = Math.round((barLength * current) / total);
        
        const filled = '█'.repeat(filledLength);
        const empty = '░'.repeat(barLength - filledLength);
        
        return theme.progress(`[${filled}${empty}] ${percentage}% (${current}/${total})`);
    }

    // Gradient text helper
    applyGradient(text, colors) {
        return gradient(colors)(text);
    }

    // Log with enhanced styling
    log(type, content, options = {}) {
        // Always output to console
        const formatted = this.formatMessage(type, content, options);
        console.log(formatted);
        // Additionally forward to listener (e.g. eventBus for WebSocket broadcast)
        if (this.listener && typeof this.listener.log === 'function') {
            this.listener.log(type, content, options);
        }
    }

    // Clear all active spinners
    clearAllSpinners() {
        this.spinners.forEach(spinner => spinner.stop());
        this.spinners.clear();
    }

    // Available themes list
    getAvailableThemes() {
        return Object.keys(this.themes);
    }

    // Format markdown text for beautiful terminal display
    formatMarkdown(content) {
        const theme = this.getTheme();
        
        // Convert markdown to formatted terminal output
        let formatted = content
            // Headers
            .replace(/^### (.*$)/gm, (match, text) => theme.accent(`\n${this.icons.star} ${text}`))
            .replace(/^## (.*$)/gm, (match, text) => theme.primary(`\n${this.icons.star} ${text.toUpperCase()}`))
            .replace(/^# (.*$)/gm, (match, text) => theme.success(`\n${this.icons.star} ${text.toUpperCase()}`))
            
            // Bold text
            .replace(/\*\*(.*?)\*\*/g, (match, text) => chalk.bold(theme.accent(text)))
            
            // Italic text
            .replace(/\*(.*?)\*/g, (match, text) => chalk.italic(theme.secondary(text)))
            
            // Inline code
            .replace(/`(.*?)`/g, (match, code) => chalk.bgGray.black(` ${code} `))
            
            // Lists
            .replace(/^[\s]*[-*+] (.*$)/gm, (match, text) => `  ${this.icons.bullet} ${text}`)
            .replace(/^[\s]*\d+\. (.*$)/gm, (match, text) => `  ${this.icons.arrow} ${text}`)
            
            // Links (show URL)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) =>
                `${theme.info(text)} ${chalk.gray(`(${url})`)}`
            )
            
            // Checkboxes
            .replace(/- \[x\] (.*$)/gm, (match, text) => `  ${this.icons.check} ${theme.success(text)}`)
            .replace(/- \[ \] (.*$)/gm, (match, text) => `  ${this.icons.radioOff} ${text}`)
            
            // Code blocks (simple highlighting)
            .replace(/```[\s\S]*?```/g, (match) => {
                const lines = match.split('\n');
                const lang = lines[0].replace('```', '').trim();
                const code = lines.slice(1, -1).join('\n');
                
                return boxen(
                    chalk.gray(code),
                    {
                        padding: 1,
                        borderStyle: 'round',
                        borderColor: 'gray',
                        title: lang ? `${lang}` : 'Code',
                        titleAlignment: 'left'
                    }
                );
            })
            
            // Horizontal rules
            .replace(/^---+$/gm, theme.system('─'.repeat(60)))
            
            // Clean up multiple newlines
            .replace(/\n{3,}/g, '\n\n');

        return formatted;
    }

    // Enhanced final response display
    displayFinalResponse(content) {
        const theme = this.getTheme();
        
        console.log('\n' + theme.accent('═'.repeat(80)));
        console.log(theme.success(`${this.icons.ai} OBOTO`));
        console.log(theme.accent('═'.repeat(80)) + '\n');
        
        const formattedContent = this.formatMarkdown(content);
        console.log(formattedContent);
        
        console.log('\n' + theme.accent('═'.repeat(80)));
    }
}

// Create singleton instance
export const consoleStyler = new ConsoleStyler();
