/**
 * CLI File Commands — Unix-style wrappers for file operations
 *
 * Commands: cat, ls, write, edit, grep, head, tail, wc
 * Each returns { output: string, exitCode: number }
 */

import fs from 'fs';
import path from 'path';

/**
 * Create file commands bound to a FileTools instance.
 * @param {import('../../tools/file-tools.mjs').FileTools} fileTools
 * @returns {Object} command registry
 */
export function createFileCommands(fileTools) {
    return {
        cat: {
            help: 'Read a text file. Supports line ranges via cat file:100-200. For images use "see". For binary use "cat -b".',
            usage: 'cat <path>[:<start>-<end>] [-b]',
            /**
             * @param {string[]} args — positional arguments
             * @param {string} [stdin] — piped input (ignored for cat)
             */
            async execute(args, stdin) {
                if (args.length === 0) {
                    // If stdin is available (piped), just pass it through
                    if (stdin !== undefined) {
                        return { output: stdin, exitCode: 0 };
                    }
                    return {
                        output: 'cat: usage: cat <path> [-b]\n  Read a text file and output its content.\n  -b  Read as binary (show hex preview)',
                        exitCode: 1,
                    };
                }

                let filePath = args[0];
                let lineStart = null;
                let lineEnd = null;

                // Support line-range syntax: cat file.txt:100-200
                if (filePath.includes(':')) {
                    const colonIdx = filePath.lastIndexOf(':');
                    const rangePart = filePath.substring(colonIdx + 1);
                    const rangeMatch = rangePart.match(/^(\d+)(?:-(\d+))?$/);
                    if (rangeMatch) {
                        filePath = filePath.substring(0, colonIdx);
                        lineStart = parseInt(rangeMatch[1], 10);
                        lineEnd = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : lineStart;
                    }
                }

                // Detect directory paths and redirect to ls
                try {
                    const resolvedPath = path.resolve(fileTools.workspaceRoot, filePath);
                    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
                        // Auto-redirect: cat on a directory → ls
                        const lsResult = await fileTools.listFiles({ path: filePath, recursive: false });
                        if (lsResult.startsWith('[error]')) {
                            return { output: lsResult, exitCode: 1 };
                        }
                        return { output: lsResult, exitCode: 0 };
                    }
                } catch { /* fall through to readFile */ }

                const result = await fileTools.readFile({ path: filePath });

                if (result.startsWith('[error]')) {
                    return { output: result, exitCode: 1 };
                }

                // Apply line-range extraction if requested
                if (lineStart !== null) {
                    const allLines = result.split('\n');
                    const start = Math.max(1, lineStart);
                    const end = Math.min(allLines.length, lineEnd);
                    const selectedLines = allLines.slice(start - 1, end);
                    const header = `[lines ${start}-${end} of ${allLines.length}]`;
                    return { output: `${header}\n${selectedLines.join('\n')}`, exitCode: 0 };
                }

                return { output: result, exitCode: 0 };
            },
        },

        ls: {
            help: 'List files in current workspace or given path.',
            usage: 'ls [path] [-r] [-a] [-l]',
            async execute(args, stdin) {
                // Parse flags — support both separate (-r -a) and combined (-la, -ral) forms
                let recursive = false;
                let showHidden = false;
                let longFormat = false;

                const positionalArgs = [];
                for (const arg of args) {
                    if (arg === '--recursive') {
                        recursive = true;
                    } else if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
                        // Parse combined short flags like -la, -ral, -al
                        for (const ch of arg.slice(1)) {
                            if (ch === 'r' || ch === 'R') recursive = true;
                            else if (ch === 'a' || ch === 'A') showHidden = true;
                            else if (ch === 'l') longFormat = true;
                            // Silently ignore unknown flags (like real ls does)
                        }
                    } else {
                        positionalArgs.push(arg);
                    }
                }

                const dirPath = positionalArgs[0] || '.';

                // If long format requested, do a stat-based listing ourselves
                if (longFormat) {
                    try {
                        // Use validatePath to enforce workspace confinement —
                        // prevents path traversal (e.g. `ls -l ../../etc`)
                        const resolvedDir = fileTools.validatePath(dirPath);
                        if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
                            return { output: `[error] ls: not a directory: ${dirPath}`, exitCode: 1 };
                        }
                        const entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
                        const lines = [];
                        for (const entry of entries) {
                            if (!showHidden && entry.name.startsWith('.')) continue;
                            if (entry.name === 'node_modules' || entry.name === '.git') continue;
                            const fullPath = path.join(resolvedDir, entry.name);
                            try {
                                const stat = await fs.promises.stat(fullPath);
                                const size = String(stat.size).padStart(8);
                                const date = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
                                const type = entry.isDirectory() ? 'd' : '-';
                                const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
                                lines.push(`${type} ${size} ${date} ${name}`);
                            } catch {
                                lines.push(`? ${' '.repeat(8)} ${'?'.repeat(16)} ${entry.name}`);
                            }
                        }
                        if (lines.length === 0) {
                            return { output: `(empty directory)`, exitCode: 0 };
                        }
                        return { output: lines.join('\n'), exitCode: 0 };
                    } catch (err) {
                        return { output: `[error] ls: ${err.message}`, exitCode: 1 };
                    }
                }

                // Pre-check: if ls is called on a file, auto-redirect to cat
                try {
                    const resolvedDir = fileTools.validatePath(dirPath);
                    if (fs.existsSync(resolvedDir) && !fs.statSync(resolvedDir).isDirectory()) {
                        // Auto-redirect: ls on a file → cat
                        const catResult = await fileTools.readFile({ path: dirPath });
                        return { output: catResult, exitCode: catResult.startsWith('[error]') ? 1 : 0 };
                    }
                } catch { /* fall through to listFiles */ }

                const result = await fileTools.listFiles({ path: dirPath, recursive, includeHidden: showHidden });

                if (result.startsWith('[error]')) {
                    return { output: result, exitCode: 1 };
                }

                return { output: result, exitCode: 0 };
            },
        },

        write: {
            help: 'Write content to a file. Content from stdin (pipe) or argument.',
            usage: 'write <path> [content]\n  Pipe content: echo "hello" | write file.txt\n  Direct: write file.txt "hello world"',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'write: usage: write <path> [content]\n  Write content to a file.\n  Content can come from stdin (pipe) or as second argument.\n  Examples:\n    write file.txt "hello world"\n    cat template.txt | write output.txt',
                        exitCode: 1,
                    };
                }

                const filePath = args[0];
                const content = args.slice(1).join(' ') || stdin || '';

                if (!content) {
                    return {
                        output: `[error] write: no content provided for ${filePath}. Provide content as argument or pipe it in.`,
                        exitCode: 1,
                    };
                }

                const result = await fileTools.writeFile({ path: filePath, content });

                if (result.startsWith('[error]')) {
                    return { output: result, exitCode: 1 };
                }

                return { output: result, exitCode: 0 };
            },
        },

        edit: {
            help: 'Apply search/replace edits to a file.',
            usage: 'edit <path> <search> <replace>',
            async execute(args, stdin) {
                if (args.length < 3) {
                    return {
                        output: 'edit: usage: edit <path> <search> <replace>\n  Apply a single search/replace edit to a file.\n  Use quotes for multi-word search/replace strings.',
                        exitCode: 1,
                    };
                }

                const filePath = args[0];
                const search = args[1];
                const replace = args[2];

                const result = await fileTools.editFile({
                    path: filePath,
                    edits: [{ search, replace }],
                });

                if (result.startsWith('[error]')) {
                    return { output: result, exitCode: 1 };
                }

                return { output: result, exitCode: 0 };
            },
        },

        grep: {
            help: 'Filter lines matching a pattern. Works on file or piped input.',
            usage: 'grep <pattern> [file] [-i] [-v] [-c]',
            async execute(args, stdin) {
                if (args.length === 0) {
                    return {
                        output: 'grep: usage: grep <pattern> [file] [-i] [-v] [-c]\n  Filter lines matching a pattern.\n  -i  Case-insensitive\n  -v  Invert match (show non-matching lines)\n  -c  Count matches only\n  Works on piped input or reads from file.',
                        exitCode: 1,
                    };
                }

                const flags = {
                    ignoreCase: args.includes('-i'),
                    invert: args.includes('-v'),
                    count: args.includes('-c'),
                };
                const positionalArgs = args.filter(a => !a.startsWith('-'));
                const pattern = positionalArgs[0];
                const filePath = positionalArgs[1];

                let text = stdin;

                // If we have a file path and no stdin, read the file
                if (filePath && text === undefined) {
                    const content = await fileTools.readFile({ path: filePath });
                    if (content.startsWith('[error]')) {
                        return { output: content, exitCode: 1 };
                    }
                    text = content;
                }

                if (text === undefined || text === null) {
                    return {
                        output: '[error] grep: no input. Provide a file path or pipe text in.',
                        exitCode: 1,
                    };
                }

                try {
                    const regex = new RegExp(pattern, flags.ignoreCase ? 'i' : '');
                    const lines = text.split('\n');
                    const matched = lines.filter(line => {
                        const matches = regex.test(line);
                        return flags.invert ? !matches : matches;
                    });

                    if (flags.count) {
                        return { output: String(matched.length), exitCode: matched.length > 0 ? 0 : 1 };
                    }

                    if (matched.length === 0) {
                        return { output: '', exitCode: 1 }; // grep returns 1 when no match
                    }

                    return { output: matched.join('\n'), exitCode: 0 };
                } catch (e) {
                    return {
                        output: `[error] grep: invalid pattern "${pattern}": ${e.message}`,
                        exitCode: 2,
                    };
                }
            },
        },

        head: {
            help: 'Show first N lines of input.',
            usage: 'head [N] [file]',
            async execute(args, stdin) {
                const positionalArgs = args.filter(a => !a.startsWith('-'));
                let n = 10;
                let filePath = null;

                for (const arg of positionalArgs) {
                    if (/^\d+$/.test(arg)) {
                        n = parseInt(arg, 10);
                    } else {
                        filePath = arg;
                    }
                }

                // Check for -n flag
                const nIdx = args.indexOf('-n');
                if (nIdx >= 0 && args[nIdx + 1]) {
                    n = parseInt(args[nIdx + 1], 10);
                }

                let text = stdin;
                if (filePath && text === undefined) {
                    const content = await fileTools.readFile({ path: filePath });
                    if (content.startsWith('[error]')) {
                        return { output: content, exitCode: 1 };
                    }
                    text = content;
                }

                if (text === undefined || text === null) {
                    return {
                        output: 'head: usage: head [N] [file]\n  Show first N lines (default 10). Reads from pipe or file.',
                        exitCode: 1,
                    };
                }

                const lines = text.split('\n').slice(0, n);
                return { output: lines.join('\n'), exitCode: 0 };
            },
        },

        tail: {
            help: 'Show last N lines of input.',
            usage: 'tail [N] [file]',
            async execute(args, stdin) {
                const positionalArgs = args.filter(a => !a.startsWith('-'));
                let n = 10;
                let filePath = null;

                for (const arg of positionalArgs) {
                    if (/^\d+$/.test(arg)) {
                        n = parseInt(arg, 10);
                    } else {
                        filePath = arg;
                    }
                }

                const nIdx = args.indexOf('-n');
                if (nIdx >= 0 && args[nIdx + 1]) {
                    n = parseInt(args[nIdx + 1], 10);
                }

                let text = stdin;
                if (filePath && text === undefined) {
                    const content = await fileTools.readFile({ path: filePath });
                    if (content.startsWith('[error]')) {
                        return { output: content, exitCode: 1 };
                    }
                    text = content;
                }

                if (text === undefined || text === null) {
                    return {
                        output: 'tail: usage: tail [N] [file]\n  Show last N lines (default 10). Reads from pipe or file.',
                        exitCode: 1,
                    };
                }

                const lines = text.split('\n');
                const result = lines.slice(Math.max(0, lines.length - n));
                return { output: result.join('\n'), exitCode: 0 };
            },
        },

        wc: {
            help: 'Count lines, words, or characters.',
            usage: 'wc [-l] [-w] [-c] [file]',
            async execute(args, stdin) {
                const countLines = args.includes('-l') || (!args.includes('-w') && !args.includes('-c'));
                const countWords = args.includes('-w');
                const countChars = args.includes('-c');
                const positionalArgs = args.filter(a => !a.startsWith('-'));
                const filePath = positionalArgs[0];

                let text = stdin;
                if (filePath && text === undefined) {
                    const content = await fileTools.readFile({ path: filePath });
                    if (content.startsWith('[error]')) {
                        return { output: content, exitCode: 1 };
                    }
                    text = content;
                }

                if (text === undefined || text === null) {
                    return {
                        output: 'wc: usage: wc [-l] [-w] [-c] [file]\n  Count lines (-l), words (-w), or characters (-c).\n  Defaults to line count. Reads from pipe or file.',
                        exitCode: 1,
                    };
                }

                const parts = [];
                if (countLines) parts.push(String(text.split('\n').length));
                if (countWords) parts.push(String(text.split(/\s+/).filter(Boolean).length));
                if (countChars) parts.push(String(text.length));

                return { output: parts.join('\t'), exitCode: 0 };
            },
        },

        sort: {
            help: 'Sort lines of input.',
            usage: 'sort [-r] [-n] [file]',
            async execute(args, stdin) {
                const reverse = args.includes('-r');
                const numeric = args.includes('-n');
                const positionalArgs = args.filter(a => !a.startsWith('-'));
                const filePath = positionalArgs[0];

                let text = stdin;
                if (filePath && text === undefined) {
                    const content = await fileTools.readFile({ path: filePath });
                    if (content.startsWith('[error]')) {
                        return { output: content, exitCode: 1 };
                    }
                    text = content;
                }

                if (text === undefined || text === null) {
                    return {
                        output: 'sort: usage: sort [-r] [-n] [file]\n  Sort lines. -r reverse, -n numeric.',
                        exitCode: 1,
                    };
                }

                let lines = text.split('\n');
                if (numeric) {
                    lines.sort((a, b) => parseFloat(a) - parseFloat(b));
                } else {
                    lines.sort();
                }
                if (reverse) lines.reverse();

                return { output: lines.join('\n'), exitCode: 0 };
            },
        },

        uniq: {
            help: 'Remove duplicate adjacent lines.',
            usage: 'uniq [-c] [file]',
            async execute(args, stdin) {
                const showCount = args.includes('-c');
                const positionalArgs = args.filter(a => !a.startsWith('-'));
                const filePath = positionalArgs[0];

                let text = stdin;
                if (filePath && text === undefined) {
                    const content = await fileTools.readFile({ path: filePath });
                    if (content.startsWith('[error]')) {
                        return { output: content, exitCode: 1 };
                    }
                    text = content;
                }

                if (text === undefined || text === null) {
                    return {
                        output: 'uniq: usage: uniq [-c] [file]\n  Remove duplicate adjacent lines. -c show count.',
                        exitCode: 1,
                    };
                }

                const lines = text.split('\n');
                const result = [];
                let prevLine = null;
                let count = 0;

                for (const line of lines) {
                    if (line === prevLine) {
                        count++;
                    } else {
                        if (prevLine !== null) {
                            result.push(showCount ? `${count} ${prevLine}` : prevLine);
                        }
                        prevLine = line;
                        count = 1;
                    }
                }
                if (prevLine !== null) {
                    result.push(showCount ? `${count} ${prevLine}` : prevLine);
                }

                return { output: result.join('\n'), exitCode: 0 };
            },
        },

        echo: {
            help: 'Output text. Useful for piping.',
            usage: 'echo <text>',
            async execute(args, stdin) {
                return { output: args.join(' '), exitCode: 0 };
            },
        },

        find: {
            help: 'Find files by name pattern (recursive list + grep).',
            usage: 'find [path] -name <pattern>',
            async execute(args, stdin) {
                let dirPath = '.';
                let pattern = null;

                const nameIdx = args.indexOf('-name');
                if (nameIdx >= 0 && args[nameIdx + 1]) {
                    pattern = args[nameIdx + 1];
                    // First arg before -name is the path
                    if (nameIdx > 0) {
                        dirPath = args[0];
                    }
                } else if (args.length === 1) {
                    pattern = args[0];
                }

                if (!pattern) {
                    return {
                        output: 'find: usage: find [path] -name <pattern>\n  Find files matching pattern (case-insensitive substring match).',
                        exitCode: 1,
                    };
                }

                const result = await fileTools.listFiles({ path: dirPath, recursive: true });
                if (result.startsWith('[error]')) {
                    return { output: result, exitCode: 1 };
                }

                // Escape regex metacharacters except *, then replace * with .*
                const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                const regex = new RegExp(escaped, 'i');
                const matched = result.split('\n').filter(line => regex.test(line));

                if (matched.length === 0) {
                    return { output: `find: no files matching "${pattern}" in ${dirPath}`, exitCode: 1 };
                }

                return { output: matched.join('\n'), exitCode: 0 };
            },
        },
    };
}
