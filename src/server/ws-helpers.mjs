import path from 'path';
import fs from 'fs';

/**
 * Convert raw OpenAI-format conversation history to UI Message format.
 * The conversation file stores messages as {role: "user"|"assistant"|"system"|"tool", content, tool_calls},
 * but the UI expects {id, role: "user"|"ai", type: "text", content, timestamp, toolCalls}.
 *
 * Groups entire assistant response turns (which may span multiple LLM messages:
 * assistant(tool_calls) → tool(result) → assistant(tool_calls) → tool(result) → assistant(content))
 * into a single UI message with toolCalls[] and content, ensuring visual consistency
 * between live streaming and page reload.
 */
export function convertHistoryToUIMessages(history) {
    if (!Array.isArray(history)) return [];
    
    const uiMessages = [];
    let msgCounter = 0;
    
    // First pass: build a map of tool_call_id → tool result content
    const toolResultMap = {};
    for (const msg of history) {
        if (msg.role === 'tool' && msg.tool_call_id) {
            toolResultMap[msg.tool_call_id] = msg.content;
        }
    }
    
    // Second pass: group messages into UI messages
    // We iterate through history and group consecutive assistant+tool sequences
    // into a single response bubble.
    let i = 0;
    while (i < history.length) {
        const msg = history[i];
        
        // Skip system and tool messages (tool messages are consumed via toolResultMap)
        if (msg.role === 'system' || msg.role === 'tool') {
            i++;
            continue;
        }
        
        msgCounter++;
        const baseId = msg.id || `hist-${msgCounter}-${Date.now()}`;
        
        if (msg.role === 'user') {
            uiMessages.push({
                id: baseId,
                role: 'user',
                type: 'text',
                content: processContentForUI(msg.content || ''),
                timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''
            });
            i++;
        } else if (msg.role === 'assistant') {
            // Start building a grouped response message.
            // Accumulate all tool calls from consecutive assistant(tool_calls) → tool → ... sequences
            // until we find an assistant message with content (the final text response).
            const collectedToolCalls = [];
            let finalContent = '';
            
            // Process this assistant message and potentially subsequent ones in the same turn
            while (i < history.length && history[i].role !== 'user') {
                const current = history[i];
                
                if (current.role === 'system' || current.role === 'tool') {
                    // Skip (tool results are already in toolResultMap)
                    i++;
                    continue;
                }
                
                if (current.role === 'assistant') {
                    // Collect any tool calls from this assistant message
                    if (current.tool_calls && current.tool_calls.length > 0) {
                        for (const tc of current.tool_calls) {
                            let parsedArgs;
                            try {
                                parsedArgs = typeof tc.function.arguments === 'string'
                                    ? JSON.parse(tc.function.arguments)
                                    : tc.function.arguments;
                            } catch {
                                parsedArgs = tc.function.arguments;
                            }
                            
                            const pairedResult = tc.id ? toolResultMap[tc.id] : undefined;
                            
                            collectedToolCalls.push({
                                toolName: tc.function.name,
                                args: parsedArgs,
                                result: pairedResult,
                                status: 'completed'
                            });
                        }
                    }
                    
                    // Collect content (the final response text)
                    if (current.content && current.content.trim()) {
                        // Append content (usually only the last assistant message has it)
                        if (finalContent) finalContent += '\n';
                        finalContent += current.content;
                    }
                    
                    i++;
                } else {
                    // Unknown role, skip
                    i++;
                }
            }
            
            // Build the unified UI message
            const uiMsg = {
                id: baseId,
                role: 'ai',
                type: 'text',
                content: processContentForUI(finalContent),
                timestamp: history[i-1]?.timestamp ? new Date(history[i-1].timestamp).toLocaleString() : '',
            };
            
            if (collectedToolCalls.length > 0) {
                uiMsg.toolCalls = collectedToolCalls;
            }

            uiMessages.push(uiMsg);
        } else {
            // Unknown role, skip
            i++;
        }
    }
    
    return uiMessages;
}

/**
 * Process text content for UI display.
 * Converts special markers like [attached: filename] to Markdown images.
 * @param {string} content
 * @returns {string}
 */
export function processContentForUI(content) {
    if (!content) return '';
    
    // Convert [attached: filename] to markdown image
    // Assume images are served from /generated-images/ if it's a local filename
    return content.replace(/\[attached:\s*(.*?)\]/g, (match, filename) => {
        const url = filename.match(/^https?:\/\//) ? filename : `/generated-images/${filename.trim()}`;
        return `\n\n![${filename}](${url})\n\n`;
    });
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.snapshots', '__pycache__', '.cache']);

export async function getDirectoryTree(dir, maxDepth = 2, currentDepth = 0) {
    const result = [];
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        // Sort: directories first, then files, alphabetically within each group
        const sorted = entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
            if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.example') continue;
            if (IGNORED_DIRS.has(entry.name)) continue;

            const isDir = entry.isDirectory();
            const node = { name: entry.name, type: isDir ? 'directory' : 'file' };

            if (isDir && currentDepth < maxDepth) {
                node.children = await getDirectoryTree(path.join(dir, entry.name), maxDepth, currentDepth + 1);
            } else if (isDir) {
                node.children = []; // collapsed
            }

            result.push(node);
        }
    } catch (e) {
        // Ignore permission errors
    }
    return result;
}

export async function getProjectInfo(dir) {
    let fileCount = 0;
    let projectType = 'Unknown';
    let gitBranch = null;

    // Count files (simple recursive)
    async function countFiles(d) {
        try {
            const entries = await fs.promises.readdir(d, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next' || entry.name === 'target') continue;
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    await countFiles(fullPath);
                } else {
                    fileCount++;
                }
            }
        } catch (e) {
             // Ignore errors
        }
    }
    await countFiles(dir);

    // Project Type
    if (fs.existsSync(path.join(dir, 'package.json'))) projectType = 'Node.js';
    else if (fs.existsSync(path.join(dir, 'requirements.txt'))) projectType = 'Python';
    else if (fs.existsSync(path.join(dir, 'pom.xml'))) projectType = 'Java';
    else if (fs.existsSync(path.join(dir, 'Cargo.toml'))) projectType = 'Rust';
    else if (fs.existsSync(path.join(dir, 'go.mod'))) projectType = 'Go';
    else if (fs.existsSync(path.join(dir, 'composer.json'))) projectType = 'PHP';
    else if (fs.existsSync(path.join(dir, 'Gemfile'))) projectType = 'Ruby';

    // Git Branch
    try {
        const gitHeadPath = path.join(dir, '.git', 'HEAD');
        if (fs.existsSync(gitHeadPath)) {
            const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
            if (headContent.startsWith('ref: refs/heads/')) {
                gitBranch = headContent.replace('ref: refs/heads/', '');
            } else {
                gitBranch = headContent.substring(0, 7);
            }
        }
    } catch (e) {}

    // Parse Structured Development manifest (SYSTEM_MAP.md) if present
    let structuredDev = null;
    const manifestPath = path.join(dir, 'SYSTEM_MAP.md');
    if (fs.existsSync(manifestPath)) {
        try {
            const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
            structuredDev = parseManifestForUI(manifestContent);
        } catch (e) {
            // Ignore parse errors
        }
    }

    return { cwd: dir, fileCount, projectType, gitBranch, structuredDev };
}

/**
 * Parse the SYSTEM_MAP.md manifest and extract feature/invariant data for the UI.
 * Returns a structured object with features, invariants, and summary counts.
 */
export function parseManifestForUI(manifestContent) {
    const features = [];
    const invariants = [];
    let lastUpdated = null;

    // Extract last updated timestamp
    const lastUpdatedMatch = manifestContent.match(/Last Updated:\s*(.+)/);
    if (lastUpdatedMatch) {
        lastUpdated = lastUpdatedMatch[1].trim();
    }

    // Parse Feature Registry table
    // Format: | Feature ID | Name | Status | Phase | Lock Level | Priority | Dependencies |
    const registryMatch = manifestContent.match(/## 2\. Feature Registry([\s\S]*?)(?=## 3|$)/);
    if (registryMatch) {
        const lines = registryMatch[1].trim().split('\n');
        for (const line of lines) {
            if (!line.trim().startsWith('|')) continue;
            if (line.includes('Feature ID') || line.includes('---')) continue;

            const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            if (cols.length >= 4) {
                // Pad missing columns
                while (cols.length < 7) cols.push('-');
                features.push({
                    id: cols[0],
                    name: cols[1],
                    status: cols[2],
                    phase: cols[3],
                    lockLevel: cols[4],
                    priority: cols[5],
                    dependencies: cols[6]
                });
            }
        }
    }

    // Parse Global Invariants table
    // Format: | ID | Invariant | Description |
    const invariantsMatch = manifestContent.match(/## 1\. Global Invariants([\s\S]*?)(?=## 2|$)/);
    if (invariantsMatch) {
        const lines = invariantsMatch[1].trim().split('\n');
        for (const line of lines) {
            if (!line.trim().startsWith('|')) continue;
            if (line.includes('| ID') || line.includes('---')) continue;

            const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            if (cols.length >= 2) {
                while (cols.length < 3) cols.push('-');
                invariants.push({
                    id: cols[0],
                    name: cols[1],
                    description: cols[2]
                });
            }
        }
    }

    // Parse State Snapshots for recent activity
    const snapshots = [];
    const snapshotsMatch = manifestContent.match(/## 4\. State Snapshots([\s\S]*?)$/);
    if (snapshotsMatch) {
        const lines = snapshotsMatch[1].trim().split('\n');
        for (const line of lines) {
            const snapshotMatch = line.match(/^-\s*\[(.+?)\]\s*(.+)/);
            if (snapshotMatch) {
                snapshots.push({
                    timestamp: snapshotMatch[1],
                    description: snapshotMatch[2]
                });
            }
        }
    }

    // Compute summary
    const totalFeatures = features.length;
    const completedFeatures = features.filter(f => f.status === 'Completed' || f.status === 'Locked' || f.phase === 'Locked').length;
    const remainingFeatures = totalFeatures - completedFeatures;

    // Phase breakdown
    const phaseBreakdown = {};
    for (const f of features) {
        const phase = f.phase || 'Unknown';
        phaseBreakdown[phase] = (phaseBreakdown[phase] || 0) + 1;
    }

    return {
        hasManifest: true,
        lastUpdated,
        features,
        invariants,
        snapshots: snapshots.slice(-5), // Last 5 snapshots
        totalFeatures,
        completedFeatures,
        remainingFeatures,
        phaseBreakdown
    };
}

/**
 * Parse Jest JSON output (from --json flag) into our TestResults structure.
 * Jest JSON format: { numPassedTests, numFailedTests, numPendingTests, testResults: [...] }
 * Each testResult: { testFilePath, testResults: [{ title, status, duration, failureMessages }] }
 */
export function parseJestJsonOutput(jestJson, testCommand, exitCode, rawOutput) {
    const suites = (jestJson.testResults || []).map(suiteResult => {
        const tests = (suiteResult.testResults || suiteResult.assertionResults || []).map(t => ({
            name: t.fullName || t.title || t.ancestorTitles?.join(' > ') + ' > ' + t.title || 'Unknown',
            status: t.status === 'passed' ? 'passed'
                  : t.status === 'failed' ? 'failed'
                  : t.status === 'pending' || t.status === 'todo' ? 'pending'
                  : 'skipped',
            duration: t.duration || 0,
            failureMessage: t.failureMessages?.length ? t.failureMessages.join('\n') : undefined
        }));

        return {
            name: suiteResult.testFilePath || suiteResult.name || 'Unknown Suite',
            tests,
            passed: tests.filter(t => t.status === 'passed').length,
            failed: tests.filter(t => t.status === 'failed').length,
            pending: tests.filter(t => t.status === 'pending' || t.status === 'skipped').length,
            duration: suiteResult.perfStats
                ? suiteResult.perfStats.end - suiteResult.perfStats.start
                : tests.reduce((sum, t) => sum + t.duration, 0)
        };
    });

    return {
        suites,
        totalPassed: jestJson.numPassedTests || 0,
        totalFailed: jestJson.numFailedTests || 0,
        totalPending: jestJson.numPendingTests || 0,
        totalDuration: jestJson.testResults
            ? jestJson.testResults.reduce((sum, s) => {
                  if (s.perfStats) return sum + (s.perfStats.end - s.perfStats.start);
                  return sum;
              }, 0)
            : 0,
        testCommand,
        exitCode,
        rawOutput: rawOutput || undefined
    };
}
