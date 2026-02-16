// Native file system tools
// Provides safe file operations with path validation

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../ui/console-styler.mjs';
import { config } from '../config.mjs';

export class FileTools {
    constructor(workspaceRoot) {
        this.workspaceRoot = path.resolve(workspaceRoot || config.system.workspaceRoot || process.cwd());
    }

    // Validate path is within workspace
    validatePath(filePath) {
        const resolvedPath = path.resolve(this.workspaceRoot, filePath);
        
        // Check if path starts with workspace root
        if (!resolvedPath.startsWith(this.workspaceRoot)) {
            // Allow access to temporary files if needed, but for now strict workspace confinement
            throw new Error(`Access denied: Path '${filePath}' is outside the workspace root.`);
        }
        
        return resolvedPath;
    }

    // Read file content
    async readFile(args) {
        const { path: filePath, encoding = 'utf8' } = args;
        
        consoleStyler.log('working', `Reading file: ${filePath}`);
        
        try {
            const resolvedPath = this.validatePath(filePath);
            
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`File not found: ${filePath}`);
            }
            
            const content = await fs.promises.readFile(resolvedPath, encoding);
            consoleStyler.log('working', `✓ Read ${content.length} characters`);
            
            return content;
        } catch (error) {
            consoleStyler.log('error', `Read file failed: ${error.message}`);
            return `Error reading file: ${error.message}`;
        }
    }

    // Write content to file
    async writeFile(args) {
        const { path: filePath, content, encoding = 'utf8' } = args;
        
        consoleStyler.log('working', `Writing file: ${filePath}`);
        
        try {
            const resolvedPath = this.validatePath(filePath);
            
            // Ensure directory exists
            const dirPath = path.dirname(resolvedPath);
            if (!fs.existsSync(dirPath)) {
                await fs.promises.mkdir(dirPath, { recursive: true });
            }
            
            // Check allowed extensions if configured
            if (config.tools.allowedFileExtensions && config.tools.allowedFileExtensions.length > 0) {
                const ext = path.extname(filePath);
                if (!config.tools.allowedFileExtensions.includes(ext) && !config.tools.enableUnsafeTools) {
                    throw new Error(`File extension '${ext}' not allowed. Allowed: ${config.tools.allowedFileExtensions.join(', ')}`);
                }
            }
            
            await fs.promises.writeFile(resolvedPath, content, encoding);
            consoleStyler.log('working', `✓ Wrote ${content.length} characters to ${filePath}`);
            
            return `Successfully wrote to ${filePath}`;
        } catch (error) {
            consoleStyler.log('error', `Write file failed: ${error.message}`);
            return `Error writing file: ${error.message}`;
        }
    }

    // List files in directory
    async listFiles(args) {
        const { path: dirPath = '.', recursive = false } = args;
        
        consoleStyler.log('working', `Listing files in: ${dirPath} (recursive: ${recursive})`);
        
        try {
            const resolvedPath = this.validatePath(dirPath);
            
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`Directory not found: ${dirPath}`);
            }
            
            const files = [];
            const MAX_FILES = 5000;
            const MAX_DEPTH = 10;
            
            async function scanDir(currentPath, relativePath, depth = 0) {
                if (depth > MAX_DEPTH) return;
                if (files.length >= MAX_FILES) return;

                const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (files.length >= MAX_FILES) break;

                    // Skip hidden files/dirs (starting with .) except specific allowed ones if needed
                    // And explicitly skip node_modules and .git
                    if (entry.name === 'node_modules' || entry.name === '.git' || (entry.name.startsWith('.') && entry.name !== '.cursorrules' && entry.name !== '.env')) {
                        continue;
                    }

                    const entryRelativePath = path.join(relativePath, entry.name);
                    
                    if (entry.isDirectory()) {
                        files.push(`${entryRelativePath}/`);
                        if (recursive) {
                            await scanDir(path.join(currentPath, entry.name), entryRelativePath, depth + 1);
                        }
                    } else {
                        files.push(entryRelativePath);
                    }
                }
            }
            
            await scanDir(resolvedPath, dirPath === '.' ? '' : dirPath);
            
            if (files.length >= MAX_FILES) {
                consoleStyler.log('warning', `⚠️ File listing truncated at ${MAX_FILES} entries`);
            }
            consoleStyler.log('working', `✓ Found ${files.length} files/directories`);
            return files.join('\n');
            
        } catch (error) {
            consoleStyler.log('error', `List files failed: ${error.message}`);
            return `Error listing files: ${error.message}`;
        }
    }
}
