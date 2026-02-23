import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError, wsHandler, requireService } from '../../lib/ws-utils.mjs';

/**
 * Handles all surface-related message types:
 * get-surfaces, get-surface, create-surface, update-surface, delete-surface,
 * pin-surface, rename-surface, duplicate-surface, remove-surface-component,
 * update-surface-layout, surface-agent-request, surface-handler-invoke,
 * surface-compilation-error, surface-get-state, surface-set-state, screenshot-captured
 */

const SM = 'toolExecutor.surfaceManager';
const SM_LABEL = 'Surface manager';

const handleGetSurfaces = wsHandler(async (data, ctx, svc) => {
    const surfaces = await svc.listSurfaces();
    wsSend(ctx.ws, 'surface-list', surfaces);
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to list surfaces' });

const handleGetSurface = wsHandler(async (data, ctx, svc) => {
    const { id } = data.payload;
    const surface = await svc.getSurface(id);
    
    if (surface) {
        // Load sources for all components
        const sources = {};
        for (const comp of surface.components) {
            const source = await svc.getComponentSource(id, comp.name);
            if (source) {
                sources[comp.id] = source;
            }
        }
        wsSend(ctx.ws, 'surface-data', { surface, sources });
    } else {
        wsSendError(ctx.ws, `Surface ${id} not found`);
    }
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to get surface' });

const handleCreateSurface = wsHandler(async (data, ctx, svc) => {
    const { name, description, layout } = data.payload;
    const surface = await svc.createSurface(name, description || '', layout || 'vertical');
    if (ctx.eventBus) {
        ctx.eventBus.emit('surface:created', surface);
    }
    wsSend(ctx.ws, 'surface-created', surface);
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to create surface' });

const handleUpdateSurface = wsHandler(async (data, ctx, svc) => {
    const { surface_id, component_name, jsx_source, props, order } = data.payload;
    const surface = await svc.updateComponent(
        surface_id, component_name, jsx_source, props || {}, order ?? null
    );
    const component = surface.components.find(c => c.name === component_name);
    const updatePayload = { surfaceId: surface_id, component, source: jsx_source, layout: surface.layout };
    if (ctx.eventBus) {
        ctx.eventBus.emit('surface:updated', updatePayload);
    }
    wsSend(ctx.ws, 'surface-updated', updatePayload);
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to update surface' });

const handleDeleteSurface = wsHandler(async (data, ctx, svc) => {
    const { surface_id } = data.payload;
    await svc.deleteSurface(surface_id);
    if (ctx.eventBus) {
        ctx.eventBus.emit('surface:deleted', { surfaceId: surface_id });
    }
    wsSend(ctx.ws, 'surface-deleted', { surfaceId: surface_id });
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to delete surface' });

const handlePinSurface = wsHandler(async (data, ctx, svc) => {
    const { surface_id } = data.payload;
    await svc.togglePin(surface_id);
    const surfaces = await svc.listSurfaces();
    ctx.broadcast('surface-list', surfaces);
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to toggle pin' });

const handleRenameSurface = wsHandler(async (data, ctx, svc) => {
    const { surface_id, name } = data.payload;
    await svc.renameSurface(surface_id, name);
    const surfaces = await svc.listSurfaces();
    ctx.broadcast('surface-list', surfaces);
    wsSend(ctx.ws, 'surface-renamed', { surfaceId: surface_id, name });
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to rename surface' });

const handleDuplicateSurface = wsHandler(async (data, ctx, svc) => {
    const { surface_id, name } = data.payload;
    const duplicate = await svc.duplicateSurface(surface_id, name);
    if (ctx.eventBus) {
        ctx.eventBus.emit('surface:created', duplicate);
    }
    wsSend(ctx.ws, 'surface-created', duplicate);
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to duplicate surface' });

const handleRemoveSurfaceComponent = wsHandler(async (data, ctx, svc) => {
    const { surface_id, component_name } = data.payload;
    const success = await svc.removeComponent(surface_id, component_name);
    if (success && ctx.eventBus) {
        ctx.eventBus.emit('surface:updated', {
            surfaceId: surface_id,
            component: { name: component_name, deleted: true }
        });
    }
    wsSend(ctx.ws, 'surface-component-removed', { surface_id, component_name, success });
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to remove component' });

const handleUpdateSurfaceLayout = wsHandler(async (data, ctx, svc) => {
    const { surface_id, layout } = data.payload;
    const surface = await svc.updateLayout(surface_id, layout);
    if (ctx.eventBus) {
        ctx.eventBus.emit('surface:layout-updated', { surfaceId: surface_id, layout: surface.layout });
    }
    wsSend(ctx.ws, 'surface-layout-updated', { surfaceId: surface_id, layout: surface.layout });
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to update surface layout' });

async function handleSurfaceAgentRequest(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, prompt } = data.payload;
    try {
        const response = await assistant.run(`[Surface Request] ${prompt}`, { isRetry: false });
        wsSend(ws, 'surface-agent-response', { requestId, response });
    } catch (err) {
        wsSend(ws, 'surface-agent-response', { requestId, response: `Error: ${err.message}` });
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
            jsonData = JSON.parse(response);
        } catch (_) {
            const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
            if (fenceMatch) {
                jsonData = JSON.parse(fenceMatch[1].trim());
            } else {
                const firstBrace = response.indexOf('{');
                const lastBrace = response.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    jsonData = JSON.parse(response.substring(firstBrace, lastBrace + 1));
                } else {
                    throw new Error('Could not extract JSON from AI response');
                }
            }
        }

        wsSend(ws, 'surface-handler-result', { requestId, success: true, data: jsonData, error: null });
    } catch (err) {
        wsSend(ws, 'surface-handler-result', { requestId, success: false, data: null, error: err.message });
    }
}

async function handleSurfaceCompilationError(data, ctx) {
    // Legacy handler — now handled by surface-auto-fix. Kept for backwards compatibility.
    const { componentName, error } = data.payload;
    consoleStyler.log('error', `Surface Compilation Error (${componentName}): ${error}`);
}

// ─── Auto-Fix ────────────────────────────────────────────────────────────

const _autoFixInProgress = new Set();

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

**AVAILABLE UI COMPONENTS (use ONLY these):**
- Layout: UI.Card, UI.CardHeader, UI.CardTitle, UI.CardDescription, UI.CardContent, UI.CardFooter, UI.ScrollArea, UI.Separator
- Primitives: UI.Button, UI.Input, UI.Textarea, UI.Label, UI.Checkbox, UI.Switch, UI.Slider
- Select: UI.Select, UI.SelectTrigger, UI.SelectContent, UI.SelectItem, UI.SelectValue
- Navigation: UI.Tabs, UI.TabsList, UI.TabsTrigger, UI.TabsContent
- Accordion: UI.Accordion, UI.AccordionItem, UI.AccordionTrigger, UI.AccordionContent
- Table: UI.Table, UI.TableHeader, UI.TableBody, UI.TableRow, UI.TableHead, UI.TableCell
- Data: UI.Badge, UI.Avatar, UI.AvatarImage, UI.AvatarFallback, UI.Progress, UI.Skeleton
- Feedback: UI.Alert (NO children components — use div/span inside), UI.toast()
- Charts: UI.LineChart, UI.BarChart, UI.PieChart, UI.AreaChart, UI.Sparkline
- Icons: UI.Icons.Check, UI.Icons.X, UI.Icons.Plus, UI.Icons.Minus, UI.Icons.ChevronDown, UI.Icons.ChevronRight, UI.Icons.ChevronUp, UI.Icons.ChevronLeft, UI.Icons.Search, UI.Icons.Settings, UI.Icons.User, UI.Icons.Home, UI.Icons.File, UI.Icons.Folder, UI.Icons.Edit, UI.Icons.Trash, UI.Icons.Copy, UI.Icons.Download, UI.Icons.Upload, UI.Icons.RefreshCw, UI.Icons.Loader2, UI.Icons.AlertCircle, UI.Icons.Info, UI.Icons.CheckCircle, UI.Icons.XCircle, UI.Icons.Activity, UI.Icons.Terminal

**⚠️ COMPONENTS THAT DO NOT EXIST (avoid these):**
- NO UI.AlertTitle, UI.AlertDescription — use <div> or <span> inside UI.Alert
- NO UI.Stack — use <div className="flex flex-col gap-2">
- NO UI.Icons.Atom, UI.Icons.Orbit, UI.Icons.Cpu — these icons don't exist

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
6. If using an icon that doesn't exist, replace with a similar one from the list above.
7. Call \`update_surface_component\` with the fixed code.`;

        await assistant.run(fixPrompt, { isRetry: false });
        consoleStyler.log('system', `✅ Auto-fix completed for ${componentName}`);
    } catch (err) {
        consoleStyler.log('error', `Auto-fix failed for ${componentName}: ${err.message}`);
        wsSend(ws, 'surface-auto-fix-failed', { surfaceId, componentName, attempt, error: err.message });
    } finally {
        _autoFixInProgress.delete(fixKey);
    }
}

// ─── State ───────────────────────────────────────────────────────────────

async function handleSurfaceGetState(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, surfaceId, key } = data.payload;
    let value;
    if (assistant.toolExecutor?.surfaceManager) {
        try {
            const surface = await assistant.toolExecutor.surfaceManager.getSurface(surfaceId);
            value = surface?.state?.[key];
        } catch (_) { /* value stays undefined */ }
    }
    wsSend(ws, 'surface-state-data', { requestId, value });
}

const handleSurfaceSetState = wsHandler(async (data, ctx, svc) => {
    const { surfaceId, key, value } = data.payload;
    await svc.setSurfaceState(surfaceId, key, value);
    wsSend(ctx.ws, 'surface-state-saved', { surfaceId, key, success: true });
}, { require: SM, requireLabel: SM_LABEL });

async function handleScreenshotCaptured(data, ctx) {
    const { requestId, image, error } = data.payload;
    if (ctx.eventBus) {
        ctx.eventBus.emit('surface:screenshot-captured', { requestId, image, error });
    }
}

// ─── Surface File/Config/Tool Access Handlers ───────────────────────────

const FT = 'toolExecutor.fileTools';
const FT_LABEL = 'FileTools';

const handleSurfaceReadFile = wsHandler(async (data, ctx, svc) => {
    const { requestId, path: filePath } = data.payload;
    const content = await svc.readFile({ path: filePath });
    const MAX_SIZE = 256 * 1024;
    let truncated = false;
    let result = content;
    if (typeof content === 'string' && content.length > MAX_SIZE) {
        result = content.substring(0, MAX_SIZE) + '\n\n[TRUNCATED — file exceeds 256KB surface read limit]';
        truncated = true;
    }
    wsSend(ctx.ws, 'surface-file-result', { requestId, success: true, content: result, truncated, error: null });
}, { require: FT, requireLabel: FT_LABEL });

const handleSurfaceWriteFile = wsHandler(async (data, ctx, svc) => {
    const { requestId, path: filePath, content } = data.payload;
    const result = await svc.writeFile({ path: filePath, content });
    const success = !result.startsWith('Error');
    wsSend(ctx.ws, 'surface-file-write-result', { requestId, success, message: result, error: success ? null : result });
}, { require: FT, requireLabel: FT_LABEL });

const handleSurfaceListFiles = wsHandler(async (data, ctx, svc) => {
    const { requestId, path: dirPath, recursive } = data.payload;
    const result = await svc.listFiles({ path: dirPath || '.', recursive: !!recursive });
    const files = typeof result === 'string' ? result.split('\n').filter(Boolean) : [];
    wsSend(ctx.ws, 'surface-file-list-result', { requestId, success: true, files, error: null });
}, { require: FT, requireLabel: FT_LABEL });

const handleSurfaceReadManyFiles = wsHandler(async (data, ctx, svc) => {
    const { requestId, paths } = data.payload;
    const resultStr = await svc.readManyFiles({ paths, max_total_bytes: 256 * 1024, max_per_file_bytes: 64 * 1024 });
    const result = JSON.parse(resultStr);
    wsSend(ctx.ws, 'surface-read-many-result', { requestId, success: true, ...result, error: null });
}, { require: FT, requireLabel: FT_LABEL });

async function handleSurfaceGetConfig(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, key } = data.payload;
    try {
        const fs = await import('fs');
        const path = await import('path');
        const workspaceRoot = assistant.toolExecutor?.fileTools?.workspaceRoot || process.cwd();
        
        const config = {};
        
        // Read package.json
        const { readJsonFileSync } = await import('../../lib/json-file-utils.mjs');
        const pkgPath = path.default.join(workspaceRoot, 'package.json');
        config.packageJson = readJsonFileSync(pkgPath);
        
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
                        const v = trimmed.substring(eqIdx + 1).trim();
                        const isSecret = /key|secret|token|password|auth/i.test(k);
                        envVars[k] = isSecret ? '***' : v;
                    }
                }
                config.env = envVars;
            } catch (_) { config.env = null; }
        }
        
        config.workspaceRoot = workspaceRoot;
        config.workspaceName = path.default.basename(workspaceRoot);
        
        const result = key ? (config[key] ?? null) : config;
        wsSend(ws, 'surface-config-result', { requestId, success: true, config: result, error: null });
    } catch (err) {
        wsSend(ws, 'surface-config-result', { requestId, success: false, config: null, error: err.message });
    }
}

async function handleSurfaceCallTool(data, ctx) {
    const { ws, assistant } = ctx;
    const { requestId, toolName, args } = data.payload;
    try {
        const toolExecutor = assistant.toolExecutor;
        if (!toolExecutor) throw new Error('ToolExecutor not available');
        
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
        
        const toolCall = {
            id: requestId,
            function: {
                name: toolName,
                arguments: JSON.stringify(args || {})
            }
        };
        
        const result = await toolExecutor.executeTool(toolCall);
        wsSend(ws, 'surface-tool-result', { requestId, success: true, result: result.content, error: null });
    } catch (err) {
        wsSend(ws, 'surface-tool-result', { requestId, success: false, result: null, error: err.message });
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
