import { validateFilePath } from '../lib/path-validation.mjs';

/**
 * Pre-route: detect file paths in user input and auto-fetch them.
 * Saves a tool-call round trip by injecting file content into the
 * AI's conversation history before the first LLM call.
 *
 * @param {string} input - User's message
 * @param {Map} tools - Engine's tool map
 * @returns {Promise<Array<{tool: string, path?: string, content?: string, error?: string}>>}
 */
export async function preRouteFiles(input, tools) {
    const results = [];
    const fetchedPaths = new Set();
    
    // File path detection patterns
    const filePatterns = [
        /read\s+(?:the\s+)?file\s+([^\s,]+)/i,
        /read\s+([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
        /(?:look at|examine|analyze|analyse|check|open|inspect|review)\s+(?:the\s+)?(?:file\s+)?([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
        /(?:contents?\s+of|what's\s+in)\s+([a-zA-Z0-9_./-]+\.[a-zA-Z]+)/i,
    ];
    
    // Known file extensions for validation
    const knownExts = new Set([
        'js','ts','json','md','txt','py','html','css','yml','yaml',
        'toml','xml','sh','jsx','tsx','mjs','cjs','env','cfg','ini',
        'log','csv',
    ]);
    
    function isLikelyFilePath(str) {
        if (str.includes('/')) return true;
        const ext = str.split('.').pop()?.toLowerCase();
        return knownExts.has(ext);
    }
    
    const readFileTool = tools?.get('read_file');
    if (!readFileTool) return results;
    
    for (const pattern of filePatterns) {
        const match = input.match(pattern);
        if (match && isLikelyFilePath(match[1]) && !fetchedPaths.has(match[1])) {
            const filePath = match[1];
            // Validate path to prevent traversal attacks (e.g. ../../../etc/passwd)
            try { validateFilePath(filePath); } catch (_e) {
                results.push({ tool: 'read_file', path: filePath, error: 'Path rejected: ' + _e.message });
                continue;
            }
            fetchedPaths.add(filePath);
            try {
                const content = await readFileTool({ path: filePath });
                const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                results.push({ tool: 'read_file', path: filePath, content: contentStr.substring(0, 4000) });
            } catch (e) {
                results.push({ tool: 'read_file', path: filePath, error: e.message });
            }
        }
    }
    
    // Fallback: scan for path-like strings (e.g. "src/core/foo.mjs")
    // Only used when explicit intent patterns above found nothing, to avoid over-matching.
    if (results.length === 0) {
        const pathRegex = /(?:^|\s)((?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,5})(?:\s|$|[,;?!])/g;
        let pathMatch;
        let fallbackCount = 0;
        while ((pathMatch = pathRegex.exec(input)) !== null && fallbackCount < 3) {
            const candidate = pathMatch[1];
            // Skip URL-like patterns
            if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\//.test(candidate)) continue;
            if (isLikelyFilePath(candidate) && !fetchedPaths.has(candidate)) {
                // Validate path to prevent traversal attacks
                try { validateFilePath(candidate); } catch (_e) { continue; }
                fetchedPaths.add(candidate);
                fallbackCount++;
                try {
                    const content = await readFileTool({ path: candidate });
                    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                    results.push({ tool: 'read_file', path: candidate, content: contentStr.substring(0, 4000) });
                } catch (e) {
                    results.push({ tool: 'read_file', path: candidate, error: e.message });
                }
            }
        }
    }
    
    return results;
}

/**
 * Detect whether the user's input is about updating, fixing, or modifying
 * an existing surface.  Returns an object with detection results.
 *
 * @param {string} input - The user's message
 * @returns {{ isSurfaceUpdate: boolean, surfaceNameHint: string|null }}
 */
export function detectSurfaceUpdateIntent(input) {
    const lower = input.toLowerCase();

    // Must mention surfaces in some way
    const surfaceMentioned = /\b(surface|dashboard|panel|widget|component|ui)\b/i.test(lower);
    if (!surfaceMentioned) return { isSurfaceUpdate: false, surfaceNameHint: null };

    // Action verbs that indicate modification (not creation)
    const updateVerbs = /\b(fix|update|change|modify|edit|adjust|tweak|improve|correct|repair|patch|refactor|restyle|redesign|redo|rework|revise|enhance|add\s+to|remove\s+from|delete\s+from)\b/i;
    const isUpdate = updateVerbs.test(lower);

    // Also detect error-related requests ("the surface is broken", "compilation error", etc.)
    const errorRelated = /\b(broken|error|bug|crash|fail|not\s+working|doesn'?t\s+work|won'?t\s+render|blank|empty|missing|wrong)\b/i;
    const isErrorFix = errorRelated.test(lower);

    if (!isUpdate && !isErrorFix) return { isSurfaceUpdate: false, surfaceNameHint: null };

    // Try to extract the surface name from the input
    let surfaceNameHint = null;
    const namePatterns = [
        /(?:the\s+)?["']([^"']+)["']\s+surface/i,
        /surface\s+(?:called|named)\s+["']?([^"',]+)["']?/i,
        /(?:the\s+)?(\w[\w\s]*?)\s+(?:surface|dashboard|panel)/i,
    ];
    for (const pat of namePatterns) {
        const match = input.match(pat);
        if (match) {
            surfaceNameHint = match[1].trim();
            break;
        }
    }

    return { isSurfaceUpdate: true, surfaceNameHint };
}

/**
 * Pre-route: when the user wants to update/fix a surface, auto-fetch
 * the surface metadata and component sources so the AI has them from turn 1.
 *
 * This saves 2-3 tool call round trips (list_surfaces → read_surface) that
 * the agent would otherwise waste before it can even start fixing.
 *
 * @param {string} input - User's message
 * @param {Map} tools - Engine's tool map
 * @param {{ isSurfaceUpdate: boolean, surfaceNameHint: string|null }} surfaceIntent
 * @returns {Promise<string|null>} Surface context block to inject, or null
 */
export async function preRouteSurfaces(input, tools, surfaceIntent) {
    if (!surfaceIntent.isSurfaceUpdate) return null;

    const listSurfacesTool = tools?.get('list_surfaces');
    const readSurfaceTool = tools?.get('read_surface');
    if (!listSurfacesTool || !readSurfaceTool) return null;

    try {
        // Step 1: List all surfaces
        const listResult = await listSurfacesTool({});
        const listStr = typeof listResult === 'string' ? listResult : JSON.stringify(listResult);

        if (!listStr || listStr === 'No surfaces found.') return null;

        // Step 2: Try to find the target surface
        let targetSurfaceId = null;

        if (surfaceIntent.surfaceNameHint) {
            // Parse surface IDs from the list output
            // Format: "- SurfaceName (ID: uuid) [Pinned/Unpinned]"
            const idPattern = /\(ID:\s*([a-f0-9-]+)\)/gi;
            const nameHintLower = surfaceIntent.surfaceNameHint.toLowerCase();
            const lines = listStr.split('\n');
            for (const line of lines) {
                if (line.toLowerCase().includes(nameHintLower)) {
                    const idMatch = idPattern.exec(line);
                    if (idMatch) {
                        targetSurfaceId = idMatch[1];
                        break;
                    }
                }
            }
        }

        // If no name match, and there's only one surface, use that
        if (!targetSurfaceId) {
            const allIds = [...listStr.matchAll(/\(ID:\s*([a-f0-9-]+)\)/g)].map(m => m[1]);
            if (allIds.length === 1) {
                targetSurfaceId = allIds[0];
            }
        }

        // Step 3: Read the target surface (or just provide the list)
        if (targetSurfaceId) {
            const readResult = await readSurfaceTool({ surface_id: targetSurfaceId });
            const readStr = typeof readResult === 'string' ? readResult : JSON.stringify(readResult);

            // Phase 3b: Detect and prominently highlight client-side errors
            const hasClientErrors = readStr.includes('🚨 CLIENT-SIDE ERRORS');
            let errorHighlight = '';
            if (hasClientErrors) {
                errorHighlight = `\n🚨🚨🚨 ATTENTION: This surface has CLIENT-SIDE RENDER ERRORS. 🚨🚨🚨\n` +
                    `The errors listed above tell you EXACTLY which components are broken and WHY.\n` +
                    `You MUST fix these specific errors. Common causes:\n` +
                    `- Non-existent UI components (UI.AlertTitle, UI.Stack, etc.) → causes React Error #130\n` +
                    `- import statements → remove them, everything is a global\n` +
                    `- Missing "export default function" → add it\n` +
                    `- Unbalanced braces/brackets → count them carefully\n\n`;
            }

            return `[SURFACE CONTEXT — AUTO-FETCHED]\nThe user wants to modify an existing surface. Here is its current state:\n\n${readStr}\n\n` +
                errorHighlight +
                `[SURFACE UPDATE WORKFLOW — MANDATORY]:\n` +
                `1. You already have the surface ID and current source code above — do NOT call read_surface or list_surfaces again.\n` +
                `2. Read the existing source code carefully to understand what the component currently does.\n` +
                `3. If CLIENT-SIDE ERRORS are listed above, focus on fixing those FIRST.\n` +
                `4. Make your changes by modifying the EXISTING source code — preserve ALL existing functionality unless explicitly told to remove it.\n` +
                `5. Call update_surface_component with the COMPLETE modified source code (not a diff, the full source).\n` +
                `6. CRITICAL: The jsx_source must contain the ENTIRE component, not just the changed parts.\n` +
                `7. AFTER updating, call read_surface to VERIFY the component rendered without new CLIENT-SIDE ERRORS.\n` +
                `8. Do NOT tell the user the surface is fixed until you have verified via read_surface.\n`;
        }

        // No specific target found — provide the list so the AI can ask
        return `[SURFACE CONTEXT — AUTO-FETCHED]\nAvailable surfaces:\n${listStr}\n\n` +
            `The user wants to modify a surface. Use read_surface to get the current source code before making changes.`;
    } catch (e) {
        // Non-critical — the agent can still call tools manually
        return null;
    }
}
