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
    validatePath(filePath, allowOutside = false) {
        const resolvedPath = path.resolve(this.workspaceRoot, filePath);
        
        // Check if path starts with workspace root
        if (!allowOutside && !resolvedPath.startsWith(this.workspaceRoot)) {
            // Allow access to temporary files if needed, but for now strict workspace confinement
            throw new Error(`Access denied: Path '${filePath}' is outside the workspace root.`);
        }
        
        return resolvedPath;
    }

    // Read file content
    async readFile(args) {
        const { path: filePath, encoding = 'utf8', _allowOutside = false } = args;
        
        consoleStyler.log('working', `Reading file: ${filePath}`);
        
        try {
            const resolvedPath = this.validatePath(filePath, _allowOutside);
            
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
        const { path: filePath, content, encoding = 'utf8', _allowOutside = false } = args;
        
        consoleStyler.log('working', `Writing file: ${filePath}`);
        
        try {
            const resolvedPath = this.validatePath(filePath, _allowOutside);
            
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
        const { path: dirPath = '.', recursive = false, _allowOutside = false } = args;
        
        consoleStyler.log('working', `Listing files in: ${dirPath} (recursive: ${recursive})`);
        
        try {
            const resolvedPath = this.validatePath(dirPath, _allowOutside);
            
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

    // Read multiple files with safety caps
    async readManyFiles(args) {
        const { paths, max_total_bytes = 512 * 1024, max_per_file_bytes = 128 * 1024, encoding = 'utf8', _allowOutside = false } = args;

        if (!Array.isArray(paths) || paths.length === 0) {
            return JSON.stringify({ error: 'paths must be a non-empty array of file paths' });
        }

        if (paths.length > 50) {
            return JSON.stringify({ error: `Too many files requested (${paths.length}). Maximum is 50.` });
        }

        consoleStyler.log('working', `Reading ${paths.length} files (max total: ${(max_total_bytes / 1024).toFixed(0)}KB)...`);

        const results = [];
        let totalBytes = 0;
        let stopped = false;

        for (const filePath of paths) {
            if (stopped) {
                results.push({ path: filePath, content: null, error: 'Skipped: total size cap reached', truncated: false });
                continue;
            }

            try {
                const resolvedPath = this.validatePath(filePath, _allowOutside);

                if (!fs.existsSync(resolvedPath)) {
                    results.push({ path: filePath, content: null, error: 'File not found', truncated: false });
                    continue;
                }

                const stat = await fs.promises.stat(resolvedPath);

                // Skip binary files by extension
                const ext = path.extname(filePath).toLowerCase();
                const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.mp3', '.mp4', '.wav', '.ogg', '.zip', '.tar', '.gz', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.eot', '.pdf'];
                if (binaryExts.includes(ext)) {
                    results.push({ path: filePath, content: null, error: `Skipped binary file (${ext})`, truncated: false });
                    continue;
                }

                let truncated = false;
                let readSize = stat.size;

                // Per-file cap
                if (readSize > max_per_file_bytes) {
                    readSize = max_per_file_bytes;
                    truncated = true;
                }

                // Total cap check
                if (totalBytes + readSize > max_total_bytes) {
                    if (totalBytes >= max_total_bytes) {
                        stopped = true;
                        results.push({ path: filePath, content: null, error: 'Skipped: total size cap reached', truncated: false });
                        continue;
                    }
                    readSize = max_total_bytes - totalBytes;
                    truncated = true;
                }

                // Read the file (potentially partial)
                if (truncated && readSize < stat.size) {
                    const fd = await fs.promises.open(resolvedPath, 'r');
                    const buffer = Buffer.alloc(readSize);
                    await fd.read(buffer, 0, readSize, 0);
                    await fd.close();
                    const content = buffer.toString(encoding) + '\n\n[TRUNCATED — file is ' + stat.size + ' bytes, read ' + readSize + ']';
                    totalBytes += readSize;
                    results.push({ path: filePath, content, truncated: true });
                } else {
                    const content = await fs.promises.readFile(resolvedPath, encoding);
                    totalBytes += content.length;
                    results.push({ path: filePath, content, truncated: false });
                }

            } catch (error) {
                results.push({ path: filePath, content: null, error: error.message, truncated: false });
            }
        }

        const summary = `Read ${results.filter(r => r.content !== null).length}/${paths.length} files (${(totalBytes / 1024).toFixed(1)}KB total)`;
        consoleStyler.log('working', `✓ ${summary}`);

        return JSON.stringify({ summary, results });
    }

    // Write multiple files in a batch
    async writeManyFiles(args) {
        const { files, create_dirs = true, dry_run = false, _allowOutside = false } = args;

        if (!Array.isArray(files) || files.length === 0) {
            return JSON.stringify({ error: 'files must be a non-empty array of { path, content } objects' });
        }

        if (files.length > 30) {
            return JSON.stringify({ error: `Too many files (${files.length}). Maximum is 30 per call.` });
        }

        consoleStyler.log('working', `Writing ${files.length} files${dry_run ? ' (DRY RUN)' : ''}...`);

        const results = [];

        for (const file of files) {
            const { path: filePath, content, encoding = 'utf8' } = file;

            if (!filePath) {
                results.push({ path: '(missing)', success: false, message: 'No path specified' });
                continue;
            }

            if (content === undefined || content === null) {
                results.push({ path: filePath, success: false, message: 'No content specified' });
                continue;
            }

            try {
                const resolvedPath = this.validatePath(filePath, _allowOutside);

                // Extension check
                if (config.tools.allowedFileExtensions && config.tools.allowedFileExtensions.length > 0) {
                    const ext = path.extname(filePath);
                    if (!config.tools.allowedFileExtensions.includes(ext) && !config.tools.enableUnsafeTools) {
                        results.push({ path: filePath, success: false, message: `Extension '${ext}' not allowed` });
                        continue;
                    }
                }

                if (dry_run) {
                    results.push({ path: filePath, success: true, message: `Would write ${content.length} chars`, dryRun: true });
                    continue;
                }

                // Create directories if needed
                if (create_dirs) {
                    const dirPath = path.dirname(resolvedPath);
                    if (!fs.existsSync(dirPath)) {
                        await fs.promises.mkdir(dirPath, { recursive: true });
                    }
                }

                await fs.promises.writeFile(resolvedPath, content, encoding);
                results.push({ path: filePath, success: true, message: `Wrote ${content.length} chars` });

            } catch (error) {
                results.push({ path: filePath, success: false, message: error.message });
            }
        }

        const succeeded = results.filter(r => r.success).length;
        const summary = `Wrote ${succeeded}/${files.length} files${dry_run ? ' (dry run)' : ''}`;
        consoleStyler.log('working', `✓ ${summary}`);

        return JSON.stringify({ summary, results });
    }

    async editFile(args) {
        const { path: filePath, edits, _allowOutside = false } = args;
        
        try {
            const fs = await import('fs');
            const pathModule = await import('path');
            
            // Replicate validatePath logic since editFile uses pathModule explicitly
            const absPath = pathModule.default.resolve(this.workspaceRoot || process.cwd(), filePath);
            
            if (!_allowOutside && !absPath.startsWith(this.workspaceRoot)) {
                return `Access denied: Path '${filePath}' is outside the workspace root.`;
            }
            
            if (!fs.existsSync(absPath)) {
                return `Error: File not found: ${filePath}`;
            }
            
            let content = fs.readFileSync(absPath, 'utf8');
            const changes = [];
            
            for (let i = 0; i < edits.length; i++) {
                const edit = edits[i];
                const idx = content.indexOf(edit.search);
                if (idx === -1) {
                    changes.push(`⚠ Edit ${i + 1}: Search text not found: "${edit.search.substring(0, 60)}${edit.search.length > 60 ? '...' : ''}"`);
                    continue;
                }
                content = content.substring(0, idx) + edit.replace + content.substring(idx + edit.search.length);
                changes.push(`✓ Edit ${i + 1}: Replaced at offset ${idx} (${edit.search.length} → ${edit.replace.length} chars)`);
            }
            
            fs.writeFileSync(absPath, content, 'utf8');
            return `File edited: ${filePath}\n${changes.join('\n')}`;
        } catch (error) {
            return `Error editing file: ${error.message}`;
        }
    }
}
