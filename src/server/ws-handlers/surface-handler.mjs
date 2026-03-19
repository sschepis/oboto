import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError, wsHandler, requireService } from '../../lib/ws-utils.mjs';
import { DirectActionExecutor } from '../../surfaces/direct-action-executor.mjs';

/**
 * Handles all surface-related message types:
 * get-surfaces, get-surface, create-surface, update-surface, delete-surface,
 * pin-surface, rename-surface, duplicate-surface, remove-surface-component,
 * update-surface-layout, surface-agent-request, surface-handler-invoke,
 * surface-compilation-error, surface-get-state, surface-set-state, screenshot-captured,
 * surface-direct-invoke, surface-fetch, surface-register-action, surface-list-actions
 */

/**
 * Per-workspace DirectActionExecutor cache.
 *
 * Uses a WeakMap keyed by `toolExecutor` so that each workspace gets its own
 * isolated executor — actions registered by one workspace never leak to another.
 * When a toolExecutor is garbage-collected (workspace closed), its executor is
 * automatically released.
 *
 * NOTE: Dynamically registered actions are scoped to the executor instance for
 * a given toolExecutor. Surface components should re-register their actions on
 * mount if they depend on custom registrations.
 *
 * @type {WeakMap<object, DirectActionExecutor>}
 */
const _executorsByWorkspace = new WeakMap();

function _getDirectActionExecutor(ctx) {
    const toolExecutor = ctx.assistant?.toolExecutor;
    if (!toolExecutor) {
        throw new Error('Cannot create DirectActionExecutor: no toolExecutor available');
    }

    let executor = _executorsByWorkspace.get(toolExecutor);
    if (!executor) {
        const surfaceManager = toolExecutor.surfaceManager;
        executor = new DirectActionExecutor({ toolExecutor, surfaceManager });
        _executorsByWorkspace.set(toolExecutor, executor);
    }
    return executor;
}

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
    const { surfaceId, componentName, error } = data.payload;
    consoleStyler.log('error', `Surface Compilation Error (${componentName}): ${error}`);

    // Phase 3c: Persist the error in surface metadata so read_surface exposes it to the agent
    const surfaceManager = ctx.assistant?.toolExecutor?.surfaceManager;
    if (surfaceManager && surfaceId && componentName) {
        try {
            await surfaceManager.setComponentError(surfaceId, componentName, `[Compilation] ${error}`);
        } catch (e) {
            consoleStyler.log('warning', `Failed to persist compilation error for ${componentName}: ${e.message}`);
        }
    }
}

/**
 * Handle runtime render errors reported by the client's error boundary.
 * Persists the error in surface metadata so the agent can see it via read_surface.
 */
async function handleSurfaceRenderError(data, ctx) {
    const { surfaceId, componentName, error } = data.payload;
    consoleStyler.log('error', `Surface Render Error (${componentName}): ${error}`);

    const surfaceManager = ctx.assistant?.toolExecutor?.surfaceManager;
    if (surfaceManager && surfaceId && componentName) {
        try {
            await surfaceManager.setComponentError(surfaceId, componentName, `[Render] ${error}`);
        } catch (e) {
            consoleStyler.log('warning', `Failed to persist render error for ${componentName}: ${e.message}`);
        }
    }
}

/**
 * Handle client-side console log entries from surface components.
 * Persists them in surface metadata so `read_surface` can expose them to the agent.
 */
async function handleSurfaceConsoleLog(data, ctx) {
    const { surfaceId, componentName, entries } = data.payload;
    if (!surfaceId || !entries || !Array.isArray(entries)) return;

    const surfaceManager = ctx.assistant?.toolExecutor?.surfaceManager;
    if (surfaceManager?.appendConsoleLogs) {
        try {
            await surfaceManager.appendConsoleLogs(surfaceId, componentName, entries);
        } catch (e) {
            consoleStyler.log('warning', `Failed to persist console logs for ${componentName}: ${e.message}`);
        }
    }
}

/**
 * Handle notification from client that a component rendered successfully.
 * Clears any previously stored error for that component.
 */
async function handleSurfaceComponentSuccess(data, ctx) {
    const { surfaceId, componentName } = data.payload;

    const surfaceManager = ctx.assistant?.toolExecutor?.surfaceManager;
    if (surfaceManager && surfaceId && componentName) {
        try {
            await surfaceManager.clearComponentError(surfaceId, componentName);
        } catch (_) { /* best effort */ }
    }
}

// ─── Auto-Fix ────────────────────────────────────────────────────────────

const _autoFixInProgress = new Set();

async function handleSurfaceAutoFix(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    const { surfaceId, componentName, errorType, error, source, componentProps, attempt } = data.payload;

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

        // Resolve source: use what the client sent, or load from surfaceManager as fallback
        let resolvedSource = source;
        if (!resolvedSource) {
            try {
                resolvedSource = await surfaceManager.getComponentSource(surfaceId, componentName);
            } catch (_) { /* keep null */ }
        }

        // Build optional props context section for data-driven errors
        let propsSection = '';
        if (componentProps) {
            propsSection = `\nCOMPONENT PROPS (data the component received at crash time):\n\`\`\`json\n${componentProps}\n\`\`\`\n`;
        }

        // Load surface state if available (components may depend on surface-level state)
        let stateSection = '';
        try {
            const surface = await surfaceManager.getSurface(surfaceId);
            if (surface?.state && Object.keys(surface.state).length > 0) {
                const stateStr = JSON.stringify(surface.state, null, 2);
                if (stateStr.length < 4096) {
                    stateSection = `\nSURFACE STATE (shared state available via useSurfaceState):\n\`\`\`json\n${stateStr}\n\`\`\`\n`;
                }
            }
        } catch (_) { /* state unavailable, proceed without it */ }

        const fixPrompt = `[Surface Auto-Fix Request]
Surface ID: ${surfaceId}
Component: ${componentName}
Error Type: ${errorType}
Attempt: ${attempt}/3

ERROR:
${error}

BROKEN SOURCE CODE:
\`\`\`jsx
${resolvedSource || '(source unavailable)'}
\`\`\`
${propsSection}${stateSection}
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
5. If the error is in data handling, add null checks and fallbacks (e.g. optional chaining, default values, Array.isArray() guards).
6. If using an icon that doesn't exist, replace with a similar one from the list above.
7. If props data is undefined or missing expected fields, add defensive guards.
8. Call \`update_surface_component\` with the fixed code.`;

        // Snapshot the component's updatedAt before the fix attempt
        let preFixTimestamp;
        try {
            const surface = await surfaceManager.getSurface(surfaceId);
            const comp = surface?.components?.find(c => c.name === componentName);
            preFixTimestamp = comp?.updatedAt;
        } catch (_) { /* proceed anyway */ }

        await assistant.run(fixPrompt, { isRetry: false });

        // Verify the component was actually updated (the AI may have responded
        // without calling update_surface_component, leaving the error in place)
        try {
            const surfaceAfter = await surfaceManager.getSurface(surfaceId);
            const compAfter = surfaceAfter?.components?.find(c => c.name === componentName);
            if (!compAfter || (preFixTimestamp && compAfter.updatedAt === preFixTimestamp)) {
                consoleStyler.log('warning', `Auto-fix for ${componentName}: AI did not update the component — notifying client`);
                wsSend(ws, 'surface-auto-fix-failed', {
                    surfaceId, componentName, attempt,
                    error: 'AI completed but did not produce a fix. Try again or fix manually in the source editor.'
                });
                return;
            }
        } catch (_) { /* verification failed — assume success, client has timeout fallback */ }

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
    const success = !result.startsWith('[error]') && !result.startsWith('Error');
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
        
        const allowedTools = new Set([
            // File operations
            'read_file', 'write_file', 'list_files', 'edit_file',
            'read_many_files', 'write_many_files',
            // Search & data
            'search_web', 'evaluate_math', 'unit_conversion', 'get_image_info',
            // Surfaces
            'list_surfaces',
            // Skills (full CRUD + execution)
            'list_skills', 'read_skill', 'use_skill', 'create_skill', 'edit_skill', 'delete_skill', 'add_npm_skill',
            // Scheduling & recurring tasks
            'create_recurring_task', 'list_recurring_tasks', 'manage_recurring_task',
            // Background tasks
            'spawn_background_task', 'check_task_status'
        ]);
        
        // Also allow plugin tools explicitly marked as surface-safe
        const isPluginSurfaceSafe = toolExecutor.isPluginSurfaceSafe?.(toolName);
        
        if (!allowedTools.has(toolName) && !isPluginSurfaceSafe) {
            throw new Error(`Tool "${toolName}" is not allowed from surface context. Allowed: ${[...allowedTools].join(', ')} + surface-safe plugin tools`);
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

// ─── Rate Limiting ───────────────────────────────────────────────────────

/**
 * Simple token-bucket rate limiter for per-WebSocket throttling.
 *
 * Prevents compromised or buggy surface components from spamming
 * server-side HTTP requests or tool calls through the direct action
 * endpoints.
 *
 * Defaults: 30-token burst, refilling at 10 tokens/second.
 */
class _TokenBucket {
    constructor(maxTokens = 30, refillRate = 10) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.refillRate = refillRate; // tokens per second
        this.lastRefill = Date.now();
    }

    consume() {
        this._refill();
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }

    _refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
        this.lastRefill = now;
    }
}

/** @type {WeakMap<object, _TokenBucket>} */
const _rateLimiters = new WeakMap();

/**
 * Check (and consume) a token from the per-WebSocket rate limiter.
 * Returns `true` if the request is allowed, `false` if throttled.
 */
function _checkRateLimit(ws) {
    let bucket = _rateLimiters.get(ws);
    if (!bucket) {
        bucket = new _TokenBucket(30, 10);
        _rateLimiters.set(ws, bucket);
    }
    return bucket.consume();
}

// ─── Direct Action Execution (LLM-free) ─────────────────────────────────

/**
 * Execute a registered direct action by name — bypasses the LLM entirely.
 * Actions are registered via surface-register-action or built-in.
 */
async function handleSurfaceDirectInvoke(data, ctx) {
    const { ws } = ctx;
    const payload = data.payload || {};
    const { requestId, surfaceId, actionName, args } = payload;
    if (!requestId || !actionName) {
        return wsSendError(ws, 'surface-direct-invoke requires requestId and actionName');
    }
    if (!_checkRateLimit(ws)) {
        return wsSend(ws, 'surface-direct-result', {
            requestId, success: false, data: null,
            error: 'Rate limit exceeded — too many direct action requests. Try again shortly.',
        });
    }
    try {
        const executor = _getDirectActionExecutor(ctx);
        const result = await executor.execute(actionName, args || {}, surfaceId || null);

        if (result.success) {
            wsSend(ws, 'surface-direct-result', { requestId, success: true, data: result.data, error: null });
        } else {
            wsSend(ws, 'surface-direct-result', { requestId, success: false, data: null, error: result.error });
        }
    } catch (err) {
        wsSend(ws, 'surface-direct-result', { requestId, success: false, data: null, error: err.message });
    }
}

/**
 * Server-side HTTP proxy for surfaces — fetches external URLs without exposing
 * the browser to CORS issues and without needing the LLM.
 */
async function handleSurfaceFetch(data, ctx) {
    const { ws } = ctx;
    const payload = data.payload || {};
    const { requestId, url, method, headers, body, timeout } = payload;
    if (!requestId || !url) {
        return wsSendError(ws, 'surface-fetch requires requestId and url');
    }
    if (!_checkRateLimit(ws)) {
        return wsSend(ws, 'surface-fetch-result', {
            requestId, success: false, status: 0, statusText: '',
            headers: {}, body: null, ok: false,
            error: 'Rate limit exceeded — too many fetch proxy requests. Try again shortly.',
        });
    }
    try {
        const executor = _getDirectActionExecutor(ctx);
        const result = await executor.fetchDirect(url, {
            method: method || 'GET',
            headers: headers || {},
            body: body || undefined,
            timeout: timeout || undefined,
        });
        wsSend(ws, 'surface-fetch-result', {
            requestId,
            success: true,
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
            body: result.body,
            ok: result.ok,
            error: null,
        });
    } catch (err) {
        wsSend(ws, 'surface-fetch-result', {
            requestId,
            success: false,
            status: 0,
            statusText: '',
            headers: {},
            body: null,
            ok: false,
            error: err.message,
        });
    }
}

/**
 * Register a direct action for a surface — lets component code declare
 * server-side actions that execute tool calls, HTTP requests, or pipelines
 * without routing through the LLM.
 */
async function handleSurfaceRegisterAction(data, ctx) {
    const { ws } = ctx;
    const payload = data.payload || {};
    const { requestId, surfaceId, actionName, definition } = payload;
    if (!requestId || !actionName || !definition) {
        return wsSendError(ws, 'surface-register-action requires requestId, actionName, and definition');
    }
    if (!_checkRateLimit(ws)) {
        return wsSend(ws, 'surface-action-registered', {
            requestId, success: false, actionName, surfaceId: surfaceId || null,
            error: 'Rate limit exceeded — too many action registration requests. Try again shortly.',
        });
    }
    try {
        // Block 'function' type from WebSocket — it requires a JS function reference
        // which cannot be safely serialized over the wire
        if (definition?.type === 'function') {
            throw new Error('Function-type actions cannot be registered via WebSocket. Use tool, fetch, or pipeline types.');
        }

        // Limit pipeline step count to prevent request amplification
        // (one directInvoke call → many server-side HTTP requests)
        if (definition?.type === 'pipeline' && Array.isArray(definition.steps) && definition.steps.length > 10) {
            throw new Error('Pipeline actions registered via WebSocket are limited to 10 steps.');
        }

        const executor = _getDirectActionExecutor(ctx);

        if (surfaceId) {
            executor.registerForSurface(surfaceId, actionName, definition);
        } else {
            executor.register(actionName, definition);
        }

        wsSend(ws, 'surface-action-registered', {
            requestId,
            success: true,
            actionName,
            surfaceId: surfaceId || null,
            error: null,
        });
    } catch (err) {
        wsSend(ws, 'surface-action-registered', {
            requestId,
            success: false,
            actionName,
            surfaceId: surfaceId || null,
            error: err.message,
        });
    }
}

/**
 * Open a surface from another surface (or any client context), optionally
 * passing activation parameters.  If `params` are provided they are stored
 * in the surface state under the reserved `_activationParams` key so the
 * target surface components can retrieve them via
 * `surfaceApi.getState('_activationParams')`.
 *
 * Emits `surface-opened` which `useTabManager` already listens for to
 * auto-open the surface tab.
 */
const handleSurfaceOpenSurface = wsHandler(async (data, ctx, svc) => {
    const { requestId, surfaceId, params } = data.payload;
    if (!surfaceId) {
        return wsSendError(ctx.ws, 'surface-open-surface requires surfaceId');
    }

    // Verify the target surface exists
    const surface = await svc.getSurface(surfaceId);
    if (!surface) {
        const errMsg = `Surface "${surfaceId}" not found`;
        if (requestId) {
            wsSend(ctx.ws, 'surface-open-result', { requestId, success: false, error: errMsg });
        } else {
            wsSendError(ctx.ws, errMsg);
        }
        return;
    }

    // Store activation params in surface state if provided
    if (params && typeof params === 'object' && Object.keys(params).length > 0) {
        await svc.setSurfaceState(surfaceId, '_activationParams', params);
    }

    // Broadcast surface-opened so useTabManager opens the tab
    // (ctx.broadcast sends to ALL connected clients so the tab opens
    //  in the requesting client as well as any other open sessions)
    ctx.broadcast('surface-opened', { surfaceId, surface, params: params || null });

    // Respond to the requester with confirmation
    if (requestId) {
        wsSend(ctx.ws, 'surface-open-result', { requestId, success: true, surfaceId, error: null });
    }
}, { require: SM, requireLabel: SM_LABEL, errorPrefix: 'Failed to open surface' });

/**
 * List all available direct actions for a surface.
 */
async function handleSurfaceListActions(data, ctx) {
    const { ws } = ctx;
    const payload = data.payload || {};
    const { requestId, surfaceId } = payload;
    if (!requestId) {
        return wsSendError(ws, 'surface-list-actions requires requestId');
    }
    if (!_checkRateLimit(ws)) {
        return wsSend(ws, 'surface-actions-list', {
            requestId, success: false, actions: [],
            error: 'Rate limit exceeded — too many list-actions requests. Try again shortly.',
        });
    }
    try {
        const executor = _getDirectActionExecutor(ctx);
        const actions = executor.listActions(surfaceId || null);
        wsSend(ws, 'surface-actions-list', { requestId, success: true, actions, error: null });
    } catch (err) {
        wsSend(ws, 'surface-actions-list', { requestId, success: false, actions: [], error: err.message });
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
    'surface-render-error': handleSurfaceRenderError,
    'surface-console-log': handleSurfaceConsoleLog,
    'surface-component-success': handleSurfaceComponentSuccess,
    'surface-get-state': handleSurfaceGetState,
    'surface-set-state': handleSurfaceSetState,
    'screenshot-captured': handleScreenshotCaptured,
    'surface-read-file': handleSurfaceReadFile,
    'surface-write-file': handleSurfaceWriteFile,
    'surface-list-files': handleSurfaceListFiles,
    'surface-read-many-files': handleSurfaceReadManyFiles,
    'surface-get-config': handleSurfaceGetConfig,
    'surface-call-tool': handleSurfaceCallTool,
    'surface-auto-fix': handleSurfaceAutoFix,
    'surface-direct-invoke': handleSurfaceDirectInvoke,
    'surface-fetch': handleSurfaceFetch,
    'surface-register-action': handleSurfaceRegisterAction,
    'surface-list-actions': handleSurfaceListActions,
    'surface-open-surface': handleSurfaceOpenSurface
};
