// Code Validator
// Performs real-time validation (linting, type-checking) on files
// to provide immediate feedback to AI agents.

import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { consoleStyler } from '../ui/console-styler.mjs';

const execPromise = util.promisify(exec);

export class CodeValidator {
    constructor(workingDir) {
        this.workingDir = workingDir;
    }

    /**
     * Validates a file based on its extension.
     * @param {string} filePath - Relative path to the file
     * @returns {Promise<string|null>} - Formatted error string or null if valid
     */
    async validateFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const fullPath = path.resolve(this.workingDir, filePath);
        
        // Only validate if file exists
        if (!fs.existsSync(fullPath)) {
            return null;
        }

        try {
            if (['.ts', '.tsx'].includes(ext)) {
                return await this.validateTypeScript(filePath);
            } else if (['.js', '.mjs', '.jsx'].includes(ext)) {
                return await this.validateJavaScript(filePath);
            }
        } catch (error) {
            // If validation command fails (e.g. tsc not found), log it but don't break the tool
            consoleStyler.log('error', `Validation tool error: ${error.message}`);
            return `(Validation tool failed: ${error.message})`; 
        }

        return null;
    }

    async validateTypeScript(filePath) {
        // Run tsc on the specific file
        // --noEmit: Don't generate JS
        // --skipLibCheck: Speed up
        // --allowJs: Allow JS files in check if needed
        // --pretty false: output parseable text
        // We use npx to use local or cached tsc
        // Increased resilience with project root finding logic could go here, 
        // but cwd execution is usually sufficient for relative paths.
        
        const cmd = `npx tsc --noEmit --skipLibCheck --allowJs --target es2020 --moduleResolution node --pretty false "${filePath}"`;
        
        try {
            await execPromise(cmd, { cwd: this.workingDir, timeout: 30000 }); // 30s timeout
            return null; // Success = no output/errors
        } catch (error) {
            // timeout error
            if (error.signal === 'SIGTERM') {
                return `Validation timed out after 30s for ${filePath}`;
            }

            // tsc exits with non-zero if errors found
            // stdout contains the errors
            const output = error.stdout || error.stderr;
            return this.formatOutput(output, filePath);
        }
    }

    async validateJavaScript(filePath) {
        // Try ESLint first
        try {
            const eslintCmd = `npx eslint --no-color --format unix "${filePath}"`;
            await execPromise(eslintCmd, { cwd: this.workingDir, timeout: 20000 });
            return null;
        } catch (error) {
            // If eslint fails due to config missing or errors found
            if (error.stdout && (error.stdout.includes(filePath) || error.stdout.includes('error'))) {
                 return this.formatOutput(error.stdout, filePath);
            }
            
            // Fallback: Syntax check with node
            try {
                // node -c checks syntax
                const nodeCmd = `node --check "${filePath}"`;
                await execPromise(nodeCmd, { cwd: this.workingDir, timeout: 10000 });
                return null;
            } catch (syntaxError) {
                return `Syntax Error: ${syntaxError.stderr.trim()}`;
            }
        }
    }

    formatOutput(output, filePath) {
        if (!output) return null;

        // Clean up ANSI codes if any remain (though we try to suppress them)
        const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');

        const lines = cleanOutput.split('\n');
        
        // Filter lines relevant to the file or generic errors
        // We want to capture the specific error lines, usually formatted like "file.ts(1,1): error ..."
        const fileName = path.basename(filePath);
        const relevantLines = lines.filter(line => 
            line.includes(fileName) || 
            line.includes('error TS') || 
            (line.includes('Error:') && !line.includes('Validation tool error'))
        );
        
        if (relevantLines.length === 0) return null;

        // Limit output size to prevent context flooding
        const MAX_LINES = 15;
        if (relevantLines.length > MAX_LINES) {
            return relevantLines.slice(0, MAX_LINES).join('\n') + `\n... (${relevantLines.length - MAX_LINES} more errors truncated)`;
        }

        return relevantLines.join('\n');
    }
}
