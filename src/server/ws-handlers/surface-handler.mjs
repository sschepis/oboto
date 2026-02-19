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
    const { assistant } = ctx;
    const { surfaceId, componentName, error } = data.payload;
    consoleStyler.log('error', `Surface Compilation Error (${componentName}): ${error}`);
    
    // Add to history so the agent sees it next time
    assistant.historyManager.addMessage({
        role: 'system',
        content: `[UI Error] Component "${componentName}" (Surface: ${surfaceId}) failed to compile/render:\n${error}`
    });
    await assistant.saveConversation();
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
    'screenshot-captured': handleScreenshotCaptured
};
