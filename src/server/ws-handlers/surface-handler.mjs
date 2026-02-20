import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Handles all surface-related message types:
 * get-surfaces, get-surface, create-surface, update-surface, delete-surface,
 * pin-surface, rename-surface, duplicate-surface, remove-surface-component,
 * update-surface-layout, surface-agent-request, surface-handler-invoke,
 * surface-compilation-error, surface-get-state, surface-set-state, screenshot-captured
 */

async function handleGetSurfaces(data, ctx) {
    const { ws, assistant } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
            ws.send(JSON.stringify({ type: 'surface-list', payload: surfaces }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to list surfaces: ${err.message}` }));
        }
    }
}

async function handleGetSurface(data, ctx) {
    const { ws, assistant } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { id } = data.payload;
            const surface = await assistant.toolExecutor.surfaceManager.getSurface(id);
            
            if (surface) {
                // Load sources for all components
                const sources = {};
                for (const comp of surface.components) {
                    const source = await assistant.toolExecutor.surfaceManager.getComponentSource(id, comp.name);
                    if (source) {
                        sources[comp.id] = source;
                    }
                }
                ws.send(JSON.stringify({ type: 'surface-data', payload: { surface, sources } }));
            } else {
                ws.send(JSON.stringify({ type: 'error', payload: `Surface ${id} not found` }));
            }
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to get surface: ${err.message}` }));
        }
    }
}

async function handleCreateSurface(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { name, description, layout } = data.payload;
            const surface = await assistant.toolExecutor.surfaceManager.createSurface(name, description || '', layout || 'vertical');
            // Broadcast to ALL clients via event bus
            if (eventBus) {
                eventBus.emit('surface:created', surface);
            }
            // Also send confirmation back to the sender
            ws.send(JSON.stringify({ type: 'surface-created', payload: surface }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to create surface: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleUpdateSurface(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id, component_name, jsx_source, props, order } = data.payload;
            const surface = await assistant.toolExecutor.surfaceManager.updateComponent(
                surface_id, component_name, jsx_source, props || {}, order ?? null
            );
            const component = surface.components.find(c => c.name === component_name);
            // Broadcast to ALL clients via event bus
            // Include layout so auto-placement changes are reflected
            if (eventBus) {
                eventBus.emit('surface:updated', {
                    surfaceId: surface_id,
                    component,
                    source: jsx_source,
                    layout: surface.layout
                });
            }
            ws.send(JSON.stringify({ type: 'surface-updated', payload: { surfaceId: surface_id, component, source: jsx_source, layout: surface.layout } }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to update surface: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleDeleteSurface(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id } = data.payload;
            await assistant.toolExecutor.surfaceManager.deleteSurface(surface_id);
            // Broadcast to ALL clients via event bus
            if (eventBus) {
                eventBus.emit('surface:deleted', { surfaceId: surface_id });
            }
            ws.send(JSON.stringify({ type: 'surface-deleted', payload: { surfaceId: surface_id } }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to delete surface: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handlePinSurface(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id } = data.payload;
            await assistant.toolExecutor.surfaceManager.togglePin(surface_id);
            // Refresh the surface list for all clients
            const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
            broadcast('surface-list', surfaces);
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to toggle pin: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleRenameSurface(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id, name } = data.payload;
            await assistant.toolExecutor.surfaceManager.renameSurface(surface_id, name);
            // Refresh the surface list for all clients
            const surfaces = await assistant.toolExecutor.surfaceManager.listSurfaces();
            broadcast('surface-list', surfaces);
            // Also send the updated surface data if it's loaded
            ws.send(JSON.stringify({ type: 'surface-renamed', payload: { surfaceId: surface_id, name } }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to rename surface: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleDuplicateSurface(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id, name } = data.payload;
            const duplicate = await assistant.toolExecutor.surfaceManager.duplicateSurface(surface_id, name);
            // Broadcast to ALL clients via event bus
            if (eventBus) {
                eventBus.emit('surface:created', duplicate);
            }
            ws.send(JSON.stringify({ type: 'surface-created', payload: duplicate }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to duplicate surface: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleRemoveSurfaceComponent(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id, component_name } = data.payload;
            const success = await assistant.toolExecutor.surfaceManager.removeComponent(surface_id, component_name);
            if (success) {
                if (eventBus) {
                    eventBus.emit('surface:updated', {
                        surfaceId: surface_id,
                        component: { name: component_name, deleted: true }
                    });
                }
            }
            ws.send(JSON.stringify({ type: 'surface-component-removed', payload: { surface_id, component_name, success } }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to remove component: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleUpdateSurfaceLayout(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const { surface_id, layout } = data.payload;
            const surface = await assistant.toolExecutor.surfaceManager.updateLayout(surface_id, layout);
            if (eventBus) {
                eventBus.emit('surface:layout-updated', { surfaceId: surface_id, layout: surface.layout });
            }
            ws.send(JSON.stringify({ type: 'surface-layout-updated', payload: { surfaceId: surface_id, layout: surface.layout } }));
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: `Failed to update surface layout: ${err.message}` }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Surface manager not available' }));
    }
}

async function handleSurfaceAgentRequest(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, prompt } = data.payload;
    try {
        const response = await assistant.run(`[Surface Request] ${prompt}`, { isRetry: false });
        ws.send(JSON.stringify({
            type: 'surface-agent-response',
            payload: { requestId, response }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-agent-response',
            payload: { requestId, response: `Error: ${err.message}` }
        }));
    }
}

async function handleSurfaceHandlerInvoke(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, surfaceId, handlerName, handlerDefinition, args } = data.payload;
    try {
        // Build structured prompt with JSON schema enforcement
        const schemaStr = JSON.stringify(handlerDefinition.outputSchema, null, 2);
        const argsStr = Object.keys(args).length > 0 ? JSON.stringify(args) : 'none';
        
        let surfaceContext = '';
        if (surfaceId && assistant.toolExecutor?.surfaceManager) {
            try {
                const surface = await assistant.toolExecutor.surfaceManager.getSurface(surfaceId);
                if (surface) {
                    surfaceContext = `\nSurface: "${surface.name}" (ID: ${surfaceId})`;
                }
            } catch (_) { /* ignore */ }
        }

        const structuredPrompt = `[Surface Handler Request]${surfaceContext}
Handler: ${handlerName} (${handlerDefinition.type})
Description: ${handlerDefinition.description}
Input: ${argsStr}

You MUST respond with ONLY a valid JSON object matching this exact schema:
${schemaStr}

CRITICAL RULES:
- Return ONLY the JSON object. No text before or after.
- Do NOT wrap in markdown code blocks.
- Use your available tools to gather any information needed, then return the JSON result.
- All required fields in the schema MUST be present in your response.`;

        const response = await assistant.run(structuredPrompt, { isRetry: false });
        
        // Extract JSON from the response (strip markdown fences if present)
        let jsonData;
        try {
            // Try direct parse first
            jsonData = JSON.parse(response);
        } catch (_) {
            // Try stripping markdown code fences
            const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
            if (fenceMatch) {
                jsonData = JSON.parse(fenceMatch[1].trim());
            } else {
                // Try finding first { to last }
                const firstBrace = response.indexOf('{');
                const lastBrace = response.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonData = JSON.parse(response.substring(firstBrace, lastBrace + 1));
                } else {
                    throw new Error('Could not extract JSON from AI response');
                }
            }
        }

        ws.send(JSON.stringify({
            type: 'surface-handler-result',
            payload: { requestId, success: true, data: jsonData, error: null }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-handler-result',
            payload: { requestId, success: false, data: null, error: err.message }
        }));
    }
}

async function handleSurfaceCompilationError(data, ctx) {
    // Legacy handler — now handled by surface-auto-fix. Kept for backwards compatibility.
    const { surfaceId, componentName, error } = data.payload;
    consoleStyler.log('error', `Surface Compilation Error (${componentName}): ${error}`);
}

/**
 * Auto-fix handler: receives a surface error (compilation or runtime) with the
 * broken source code, asks the AI agent to fix it, and pushes the corrected
 * component back to the surface.
 */
const _autoFixInProgress = new Set(); // Prevent concurrent fixes for the same component

async function handleSurfaceAutoFix(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    const { surfaceId, componentName, errorType, error, source, attempt } = data.payload;

    const fixKey = `${surfaceId}:${componentName}`;
    if (_autoFixInProgress.has(fixKey)) {
        consoleStyler.log('warning', `Auto-fix already in progress for ${componentName}, skipping`);
        return;
    }

    consoleStyler.log('system', `🔧 Auto-fixing ${componentName} (${errorType} error, attempt ${attempt})`);
    _autoFixInProgress.add(fixKey);

    try {
        const surfaceManager = assistant.toolExecutor?.surfaceManager;
        if (!surfaceManager) throw new Error('SurfaceManager not available');

        // Build the fix prompt
        const fixPrompt = `[Surface Auto-Fix Request]
Surface ID: ${surfaceId}
Component: ${componentName}
Error Type: ${errorType}
Attempt: ${attempt}/3

ERROR:
${error}

BROKEN SOURCE CODE:
\`\`\`jsx
${source || '(source unavailable)'}
\`\`\`

INSTRUCTIONS:
Fix the ${errorType} error in this surface component. You MUST call the \`update_surface_component\` tool with:
- surface_id: "${surfaceId}"
- component_name: "${componentName}"
- jsx_source: the COMPLETE fixed source code

Rules:
1. Fix ONLY the error — preserve all existing functionality.
2. Do NOT add imports — all React hooks and UI.* components are globally available.
3. Export a default function component.
4. Use Tailwind CSS for styling.
5. If the error is in data handling, add null checks and fallbacks.
6. Call \`update_surface_component\` with the fixed code.`;

        // Run the assistant to fix it
        await assistant.run(fixPrompt, { isRetry: false });

        consoleStyler.log('system', `✅ Auto-fix completed for ${componentName}`);
    } catch (err) {
        consoleStyler.log('error', `Auto-fix failed for ${componentName}: ${err.message}`);
        
        // Notify the UI that the fix attempt failed
        ws.send(JSON.stringify({
            type: 'surface-auto-fix-failed',
            payload: { surfaceId, componentName, attempt, error: err.message }
        }));
    } finally {
        _autoFixInProgress.delete(fixKey);
    }
}

async function handleSurfaceGetState(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, surfaceId, key } = data.payload;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const surface = await assistant.toolExecutor.surfaceManager.getSurface(surfaceId);
            const value = surface?.state?.[key];
            ws.send(JSON.stringify({
                type: 'surface-state-data',
                payload: { requestId, value }
            }));
        } catch (err) {
            ws.send(JSON.stringify({
                type: 'surface-state-data',
                payload: { requestId, value: undefined }
            }));
        }
    } else {
        ws.send(JSON.stringify({
            type: 'surface-state-data',
            payload: { requestId, value: undefined }
        }));
    }
}

async function handleSurfaceSetState(data, ctx) {
    const { ws, assistant } = ctx;
    const { surfaceId, key, value } = data.payload;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            await assistant.toolExecutor.surfaceManager.setSurfaceState(surfaceId, key, value);
            ws.send(JSON.stringify({
                type: 'surface-state-saved',
                payload: { surfaceId, key, success: true }
            }));
        } catch (err) {
            ws.send(JSON.stringify({
                type: 'surface-state-saved',
                payload: { surfaceId, key, success: false, error: err.message }
            }));
        }
    }
}

async function handleScreenshotCaptured(data, ctx) {
    const { eventBus } = ctx;
    const { requestId, image, error } = data.payload;
    if (eventBus) {
        eventBus.emit('surface:screenshot-captured', { requestId, image, error });
    }
}

// ─── Surface File/Config/Tool Access Handlers ───

async function handleSurfaceReadFile(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, path: filePath } = data.payload;
    try {
        const fileTools = assistant.toolExecutor?.fileTools;
        if (!fileTools) throw new Error('FileTools not available');
        
        const content = await fileTools.readFile({ path: filePath });
        // Safety cap: 256KB max for surface reads
        const MAX_SIZE = 256 * 1024;
        let truncated = false;
        let result = content;
        if (typeof content === 'string' && content.length > MAX_SIZE) {
            result = content.substring(0, MAX_SIZE) + '\n\n[TRUNCATED — file exceeds 256KB surface read limit]';
            truncated = true;
        }
        ws.send(JSON.stringify({
            type: 'surface-file-result',
            payload: { requestId, success: true, content: result, truncated, error: null }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-file-result',
            payload: { requestId, success: false, content: null, truncated: false, error: err.message }
        }));
    }
}

async function handleSurfaceWriteFile(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, path: filePath, content } = data.payload;
    try {
        const fileTools = assistant.toolExecutor?.fileTools;
        if (!fileTools) throw new Error('FileTools not available');
        
        const result = await fileTools.writeFile({ path: filePath, content });
        const success = !result.startsWith('Error');
        ws.send(JSON.stringify({
            type: 'surface-file-write-result',
            payload: { requestId, success, message: result, error: success ? null : result }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-file-write-result',
            payload: { requestId, success: false, message: null, error: err.message }
        }));
    }
}

async function handleSurfaceListFiles(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, path: dirPath, recursive } = data.payload;
    try {
        const fileTools = assistant.toolExecutor?.fileTools;
        if (!fileTools) throw new Error('FileTools not available');
        
        const result = await fileTools.listFiles({ path: dirPath || '.', recursive: !!recursive });
        const files = typeof result === 'string' ? result.split('\n').filter(Boolean) : [];
        ws.send(JSON.stringify({
            type: 'surface-file-list-result',
            payload: { requestId, success: true, files, error: null }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-file-list-result',
            payload: { requestId, success: false, files: [], error: err.message }
        }));
    }
}

async function handleSurfaceReadManyFiles(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, paths } = data.payload;
    try {
        const fileTools = assistant.toolExecutor?.fileTools;
        if (!fileTools) throw new Error('FileTools not available');
        
        const resultStr = await fileTools.readManyFiles({ paths, max_total_bytes: 256 * 1024, max_per_file_bytes: 64 * 1024 });
        const result = JSON.parse(resultStr);
        ws.send(JSON.stringify({
            type: 'surface-read-many-result',
            payload: { requestId, success: true, ...result, error: null }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-read-many-result',
            payload: { requestId, success: false, summary: null, results: [], error: err.message }
        }));
    }
}

async function handleSurfaceGetConfig(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, key } = data.payload;
    try {
        const fs = await import('fs');
        const path = await import('path');
        const workspaceRoot = assistant.toolExecutor?.fileTools?.workspaceRoot || process.cwd();
        
        const config = {};
        
        // Read package.json
        const pkgPath = path.default.join(workspaceRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                config.packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            } catch (_) { config.packageJson = null; }
        }
        
        // Read .env (parsed, not raw — hide secrets by default)
        const envPath = path.default.join(workspaceRoot, '.env');
        if (fs.existsSync(envPath)) {
            try {
                const envContent = fs.readFileSync(envPath, 'utf8');
                const envVars = {};
                for (const line of envContent.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const k = trimmed.substring(0, eqIdx).trim();
                        // Mask values that look like secrets
                        const v = trimmed.substring(eqIdx + 1).trim();
                        const isSecret = /key|secret|token|password|auth/i.test(k);
                        envVars[k] = isSecret ? '***' : v;
                    }
                }
                config.env = envVars;
            } catch (_) { config.env = null; }
        }
        
        // Basic workspace info
        config.workspaceRoot = workspaceRoot;
        config.workspaceName = path.default.basename(workspaceRoot);
        
        // If a specific key is requested, return just that
        const result = key ? (config[key] ?? null) : config;
        
        ws.send(JSON.stringify({
            type: 'surface-config-result',
            payload: { requestId, success: true, config: result, error: null }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-config-result',
            payload: { requestId, success: false, config: null, error: err.message }
        }));
    }
}

async function handleSurfaceCallTool(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, toolName, args } = data.payload;
    try {
        const toolExecutor = assistant.toolExecutor;
        if (!toolExecutor) throw new Error('ToolExecutor not available');
        
        // Only allow a whitelist of safe tools from surfaces
        const allowedTools = [
            'read_file', 'write_file', 'list_files', 'edit_file',
            'read_many_files', 'write_many_files',
            'search_web', 'list_surfaces', 'list_skills',
            'evaluate_math', 'unit_conversion',
            'get_image_info'
        ];
        
        if (!allowedTools.includes(toolName)) {
            throw new Error(`Tool "${toolName}" is not allowed from surface context. Allowed: ${allowedTools.join(', ')}`);
        }
        
        // Build a synthetic tool call object
        const toolCall = {
            id: requestId,
            function: {
                name: toolName,
                arguments: JSON.stringify(args || {})
            }
        };
        
        const result = await toolExecutor.executeTool(toolCall);
        ws.send(JSON.stringify({
            type: 'surface-tool-result',
            payload: { requestId, success: true, result: result.content, error: null }
        }));
    } catch (err) {
        ws.send(JSON.stringify({
            type: 'surface-tool-result',
            payload: { requestId, success: false, result: null, error: err.message }
        }));
    }
}

export const handlers = {
    'get-surfaces': handleGetSurfaces,
    'get-surface': handleGetSurface,
    'create-surface': handleCreateSurface,
    'update-surface': handleUpdateSurface,
    'delete-surface': handleDeleteSurface,
    'pin-surface': handlePinSurface,
    'rename-surface': handleRenameSurface,
    'duplicate-surface': handleDuplicateSurface,
    'remove-surface-component': handleRemoveSurfaceComponent,
    'update-surface-layout': handleUpdateSurfaceLayout,
    'surface-agent-request': handleSurfaceAgentRequest,
    'surface-handler-invoke': handleSurfaceHandlerInvoke,
    'surface-compilation-error': handleSurfaceCompilationError,
    'surface-get-state': handleSurfaceGetState,
    'surface-set-state': handleSurfaceSetState,
    'screenshot-captured': handleScreenshotCaptured,
    'surface-read-file': handleSurfaceReadFile,
    'surface-write-file': handleSurfaceWriteFile,
    'surface-list-files': handleSurfaceListFiles,
    'surface-read-many-files': handleSurfaceReadManyFiles,
    'surface-get-config': handleSurfaceGetConfig,
    'surface-call-tool': handleSurfaceCallTool,
    'surface-auto-fix': handleSurfaceAutoFix
};
