import { SurfaceManager } from '../../surfaces/surface-manager.mjs';

export class SurfaceHandlers {
    constructor(surfaceManager, eventBus) {
        this.surfaceManager = surfaceManager;
        this.eventBus = eventBus;
    }

    async createSurface(args) {
        try {
            const { name, description, layout } = args;
            const surface = await this.surfaceManager.createSurface(name, description, layout);
            
            if (this.eventBus) {
                this.eventBus.emit('surface:created', surface);
            }
            
            return `Surface created successfully.\nID: ${surface.id}\nName: ${surface.name}\n\nThe surface is now open and ready for components.`;
        } catch (error) {
            return `[error] create_surface: ${error.message}`;
        }
    }

    async updateSurfaceComponent(args) {
        try {
            const { surface_id, component_name, jsx_source, props, order } = args;

            // ── Phase 1b: Static validation gate ──────────────────────────
            const validation = SurfaceManager.validateJsxSource(jsx_source);
            if (!validation.valid) {
                const errorList = validation.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
                let msg = `[error] update_surface_component: JSX validation FAILED for '${component_name}'. ` +
                    `The component was NOT written to disk.\n\nErrors:\n${errorList}\n\n` +
                    `Fix these errors and call update_surface_component again with corrected jsx_source.`;
                if (validation.warnings.length > 0) {
                    msg += `\n\nWarnings:\n${validation.warnings.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}`;
                }
                return msg;
            }

            // Check if the component already existed (update vs create)
            const existingSurface = await this.surfaceManager.getSurface(surface_id);
            const wasExisting = existingSurface?.components?.some(c => c.name === component_name);

            const surface = await this.surfaceManager.updateComponent(surface_id, component_name, jsx_source, props, order);
            
            // Clear any previous client errors for this component since we just wrote new code
            if (this.surfaceManager.clearComponentError) {
                await this.surfaceManager.clearComponentError(surface_id, component_name);
            }

            // Get the updated component to return details
            const component = surface.components.find(c => c.name === component_name);
            
            if (this.eventBus) {
                // Include layout so auto-placement changes are reflected on the client
                this.eventBus.emit('surface:updated', {
                    surfaceId: surface_id,
                    component,
                    source: jsx_source,
                    layout: surface.layout
                });
            }

            // Return detailed context with verification instruction
            const action = wasExisting ? 'Updated' : 'Created';
            const sourceLen = jsx_source ? jsx_source.length : 0;
            const compCount = surface.components.length;
            let msg = `${action} component '${component_name}' on surface '${surface.name}' ` +
                `(${compCount} total components, ${sourceLen} chars of JSX). ` +
                `Component source written to disk and sent to client for rendering.`;
            
            if (validation.warnings.length > 0) {
                msg += `\n\nWarnings:\n${validation.warnings.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}`;
            }

            msg += `\n\n⚠️ IMPORTANT: The component has NOT been verified to render correctly yet. ` +
                `You MUST call read_surface or capture_surface to verify it rendered without errors before reporting success to the user.`;

            return msg;
        } catch (error) {
            return `[error] update_surface_component: ${error.message}. Use: list_surfaces to verify surface_id, or read_surface to check existing components.`;
        }
    }

    async removeSurfaceComponent(args) {
        try {
            const { surface_id, component_name } = args;
            const success = await this.surfaceManager.removeComponent(surface_id, component_name);
            
            if (!success) {
                return `[error] remove_surface_component: component '${component_name}' not found on surface '${surface_id}'. Use: open_surface to inspect components.`;
            }

            if (this.eventBus) {
                this.eventBus.emit('surface:updated', { 
                    surfaceId: surface_id, 
                    component: { name: component_name, deleted: true }
                });
            }

            return `Component '${component_name}' removed from surface.`;
        } catch (error) {
            return `[error] remove_surface_component: ${error.message}`;
        }
    }

    async listSurfaces(args) {
        try {
            const surfaces = await this.surfaceManager.listSurfaces();
            
            if (surfaces.length === 0) {
                return "No surfaces found.";
            }

            const list = surfaces.map(s => `- ${s.name} (ID: ${s.id}) [${s.pinned ? 'Pinned' : 'Unpinned'}]`).join('\n');
            return `Surfaces:\n${list}`;
        } catch (error) {
            return `[error] list_surfaces: ${error.message}`;
        }
    }

    async deleteSurface(args) {
        try {
            const { surface_id } = args;
            const success = await this.surfaceManager.deleteSurface(surface_id);
            
            if (!success) {
                return `[error] delete_surface: surface '${surface_id}' not found. Use: list_surfaces to see available surfaces.`;
            }

            if (this.eventBus) {
                this.eventBus.emit('surface:deleted', { surfaceId: surface_id });
            }

            return `Surface '${surface_id}' deleted successfully.`;
        } catch (error) {
            return `[error] delete_surface: ${error.message}`;
        }
    }

    async openSurface(args) {
        try {
            const { surface_id } = args;
            const surface = await this.surfaceManager.getSurface(surface_id);
            
            if (!surface) {
                return `[error] open_surface: surface '${surface_id}' not found. Use: list_surfaces to see available surfaces.`;
            }

            if (this.eventBus) {
                this.eventBus.emit('surface:opened', { surfaceId: surface_id, surface });
            }

            return `Surface '${surface.name}' (ID: ${surface_id}) opened successfully.`;
        } catch (error) {
            return `[error] open_surface: ${error.message}`;
        }
    }

    // Layout presets map (mirrors the frontend types.ts getPresetLayout)
    static LAYOUT_PRESETS = {
        dashboard: {
            type: 'flex-grid', direction: 'column', gap: '0',
            rows: [
                { id: 'header', direction: 'row', gap: '16px', flex: '0 0 auto', cells: [{ id: 'header-content', flex: 1, components: [] }], minHeight: '60px' },
                { id: 'main', direction: 'row', gap: '16px', flex: 1, cells: [
                    { id: 'col-1', flex: 1, components: [], minWidth: '200px' },
                    { id: 'col-2', flex: 1, components: [], minWidth: '200px' },
                    { id: 'col-3', flex: 1, components: [], minWidth: '200px' },
                ]},
                { id: 'footer', direction: 'row', gap: '16px', flex: '0 0 auto', cells: [{ id: 'footer-content', flex: 1, components: [] }], minHeight: '48px' },
            ]
        },
        'sidebar-left': {
            type: 'flex-grid', direction: 'row', gap: '0',
            rows: [{ id: 'layout', direction: 'row', gap: '16px', flex: 1, cells: [
                { id: 'sidebar', flex: '0 0 280px', components: [], overflow: 'auto' },
                { id: 'content', flex: 1, components: [], overflow: 'auto' },
            ]}]
        },
        'sidebar-right': {
            type: 'flex-grid', direction: 'row', gap: '0',
            rows: [{ id: 'layout', direction: 'row', gap: '16px', flex: 1, cells: [
                { id: 'content', flex: 1, components: [], overflow: 'auto' },
                { id: 'sidebar', flex: '0 0 280px', components: [], overflow: 'auto' },
            ]}]
        },
        'holy-grail': {
            type: 'flex-grid', direction: 'column', gap: '0',
            rows: [
                { id: 'header', direction: 'row', flex: '0 0 auto', gap: '0', cells: [{ id: 'header-content', flex: 1, components: [] }], minHeight: '56px' },
                { id: 'body', direction: 'row', gap: '16px', flex: 1, cells: [
                    { id: 'left-sidebar', flex: '0 0 240px', components: [], overflow: 'auto' },
                    { id: 'main-content', flex: 1, components: [], overflow: 'auto' },
                    { id: 'right-sidebar', flex: '0 0 240px', components: [], overflow: 'auto' },
                ]},
                { id: 'footer', direction: 'row', flex: '0 0 auto', gap: '0', cells: [{ id: 'footer-content', flex: 1, components: [] }], minHeight: '48px' },
            ]
        },
        'split-view': {
            type: 'flex-grid', direction: 'row', gap: '0',
            rows: [{ id: 'split', direction: 'row', gap: '1px', flex: 1, cells: [
                { id: 'left', flex: 1, components: [], overflow: 'auto' },
                { id: 'right', flex: 1, components: [], overflow: 'auto' },
            ]}]
        },
        'masonry-3': {
            type: 'flex-grid', direction: 'column', gap: '16px', padding: '16px',
            rows: [{ id: 'grid', direction: 'row', gap: '16px', flex: 1, wrap: 'wrap', cells: [
                { id: 'card-1', flex: '1 1 300px', components: [], minWidth: '280px' },
                { id: 'card-2', flex: '1 1 300px', components: [], minWidth: '280px' },
                { id: 'card-3', flex: '1 1 300px', components: [], minWidth: '280px' },
            ]}]
        },
        stack: {
            type: 'flex-grid', direction: 'column', gap: '16px', padding: '16px',
            rows: [{ id: 'stack', direction: 'column', gap: '16px', flex: 1, cells: [
                { id: 'main', flex: 1, components: [] },
            ]}]
        },
        'hero-content': {
            type: 'flex-grid', direction: 'column', gap: '0',
            rows: [
                { id: 'hero', direction: 'row', flex: '0 0 auto', gap: '0', cells: [{ id: 'hero-content', flex: 1, components: [], minHeight: '300px' }] },
                { id: 'content', direction: 'row', flex: 1, gap: '16px', cells: [{ id: 'main', flex: 1, components: [], padding: '24px' }] },
            ]
        },
        kanban: {
            type: 'flex-grid', direction: 'row', gap: '12px', padding: '12px',
            rows: [{ id: 'columns', direction: 'row', gap: '12px', flex: 1, cells: [
                { id: 'col-1', flex: '0 0 300px', components: [], overflow: 'auto' },
                { id: 'col-2', flex: '0 0 300px', components: [], overflow: 'auto' },
                { id: 'col-3', flex: '0 0 300px', components: [], overflow: 'auto' },
                { id: 'col-4', flex: '0 0 300px', components: [], overflow: 'auto' },
            ]}]
        }
    };

    async configureSurfaceLayout(args) {
        try {
            const { surface_id, preset, layout } = args;

            let resolvedLayout;
            if (preset) {
                resolvedLayout = SurfaceHandlers.LAYOUT_PRESETS[preset];
                if (!resolvedLayout) {
                    return `[error] configure_surface_layout: unknown preset '${preset}'. Available: ${Object.keys(SurfaceHandlers.LAYOUT_PRESETS).join(', ')}`;
                }
                // Deep clone to avoid mutation
                resolvedLayout = JSON.parse(JSON.stringify(resolvedLayout));
            } else if (layout) {
                if (!layout.type || layout.type !== 'flex-grid') {
                    return "[error] configure_surface_layout: custom layout must have type: 'flex-grid' and a 'rows' array.";
                }
                resolvedLayout = layout;
            } else {
                return "[error] configure_surface_layout: either 'preset' or 'layout' must be provided. Available presets: " + Object.keys(SurfaceHandlers.LAYOUT_PRESETS).join(', ');
            }

            const surface = await this.surfaceManager.updateLayout(surface_id, resolvedLayout);

            if (this.eventBus) {
                this.eventBus.emit('surface:layout-updated', { surfaceId: surface_id, layout: resolvedLayout });
            }

            // Describe the cell IDs available for component placement
            const cellIds = [];
            for (const row of resolvedLayout.rows) {
                for (const cell of row.cells) {
                    cellIds.push(cell.id);
                }
            }

            return `Surface layout updated to ${preset || 'custom flex-grid'}.\nAvailable cell IDs for component placement: ${cellIds.join(', ')}`;
        } catch (error) {
            return `[error] configure_surface_layout: ${error.message}`;
        }
    }

    async placeComponentInCell(args) {
        try {
            const { surface_id, component_name, cell_id } = args;
            const surface = await this.surfaceManager.placeComponentInCell(surface_id, component_name, cell_id);

            if (this.eventBus) {
                this.eventBus.emit('surface:layout-updated', { surfaceId: surface_id, layout: surface.layout });
            }

            return `Component '${component_name}' placed in cell '${cell_id}'.`;
        } catch (error) {
            return `[error] place_component_in_cell: ${error.message}. Use: configure_surface_layout to see available cell IDs.`;
        }
    }

    async captureSurface(args) {
        try {
            const { surface_id } = args;
            const surface = await this.surfaceManager.getSurface(surface_id);
            
            if (!surface) {
                return `[error] capture_surface: surface '${surface_id}' not found. Use: list_surfaces to see available surfaces.`;
            }

            if (!this.eventBus) {
                return "[error] capture_surface: event bus not available to request screenshot.";
            }

            const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Create a promise that waits for the response
            const responsePromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.eventBus.off('surface:screenshot-captured', listener);
                    reject(new Error("Timeout waiting for screenshot from client."));
                }, 10000);

                const listener = (data) => {
                    if (data.requestId === requestId) {
                        clearTimeout(timeout);
                        this.eventBus.off('surface:screenshot-captured', listener);
                        if (data.error) {
                            reject(new Error(data.error));
                        } else {
                            resolve(data.image);
                        }
                    }
                };

                this.eventBus.on('surface:screenshot-captured', listener);
            });

            // Emit the request
            this.eventBus.emit('surface:request-screenshot', { requestId, surfaceId: surface_id });

            // Wait for response
            const screenshotBase64 = await responsePromise;

            // Return as a browser preview object so the UI renders it
            return JSON.stringify({
                _type: 'browser_preview',
                url: `surface://${surface.name}`,
                title: `Surface: ${surface.name}`,
                screenshot: screenshotBase64,
                logs: [],
                networkLogs: [],
                error: null,
                lastAction: { type: 'screenshot', selector: `#surface-${surface_id}` }
            });

        } catch (error) {
            return JSON.stringify({
                _type: 'browser_preview',
                url: `surface://${args.surface_id}`,
                title: 'Error',
                screenshot: null,
                logs: [],
                networkLogs: [],
                error: error.message
            });
        }
    }

    async readSurface(args) {
        try {
            const { surface_id } = args;
            if (!surface_id || typeof surface_id !== 'string' || !surface_id.trim()) {
                return '[error] read_surface: surface_id is required. Use: list_surfaces to see available surfaces.';
            }
            const surface = await this.surfaceManager.getSurface(surface_id);

            if (!surface) {
                return `[error] read_surface: surface '${surface_id}' not found. Use: list_surfaces to see available surfaces.`;
            }

            // Build output with metadata
            const lines = [
                `Surface: ${surface.name}`,
                `ID: ${surface.id}`,
                `Description: ${surface.description || '(none)'}`,
                `Layout: ${typeof surface.layout === 'object' ? JSON.stringify(surface.layout) : (surface.layout || 'vertical')}`,
                `Created: ${surface.createdAt}`,
                `Updated: ${surface.updatedAt}`,
                `Pinned: ${surface.pinned ? 'Yes' : 'No'}`,
                `Theme: ${surface.theme || 'dark'}`,
                `Components: ${surface.components.length}`,
            ];

            // ── Phase 3a: Surface-level client errors ─────────────────────
            const clientErrors = surface._clientErrors;
            if (clientErrors && Object.keys(clientErrors).length > 0) {
                lines.push('');
                lines.push('🚨 CLIENT-SIDE ERRORS (components that FAILED to render):');
                for (const [compName, err] of Object.entries(clientErrors)) {
                    lines.push(`  ❌ ${compName}: ${err.message} (at ${err.timestamp})`);
                }
                lines.push('');
                lines.push('⚠️ You MUST fix these errors before the surface will work correctly.');
                lines.push('Common causes: non-existent UI.* components, unbalanced JSX, import statements, missing export default function.');
            }

            // ── Client-side console logs (in-memory ring buffer) ─────────
            const consoleLogs = this.surfaceManager.getConsoleLogs(surface_id, 30);
            if (consoleLogs && consoleLogs.length > 0) {
                lines.push('');
                lines.push(`📋 CLIENT CONSOLE LOGS (last ${consoleLogs.length}):`);
                for (const log of consoleLogs) {
                    const time = new Date(log.timestamp).toISOString().slice(11, 23);
                    const prefix = log.level === 'error' ? '❌' :
                                   log.level === 'warn'  ? '⚠️' :
                                   log.level === 'info'  ? 'ℹ️' : '  ';
                    const argsStr = Array.isArray(log.args) ? log.args.join(' ') : String(log.args);
                    lines.push(`  ${prefix} [${time}] [${log.component}] ${argsStr}`);
                }
            }

            // Include each component's source code
            for (const comp of surface.components) {
                const source = await this.surfaceManager.getComponentSource(surface_id, comp.name);
                lines.push('');
                // Mark components with client errors
                const hasError = clientErrors?.[comp.name];
                const errorMarker = hasError ? ' ❌ RENDER ERROR' : '';
                lines.push(`--- Component: ${comp.name} (order: ${comp.order})${errorMarker} ---`);
                if (hasError) {
                    lines.push(`CLIENT ERROR: ${hasError.message}`);
                }
                if (comp.props && Object.keys(comp.props).length > 0) {
                    lines.push(`Props: ${JSON.stringify(comp.props)}`);
                }
                if (source) {
                    lines.push(source);
                } else {
                    lines.push('(source not found)');
                }
            }

            return lines.join('\n');
        } catch (error) {
            return `[error] read_surface: ${error.message}`;
        }
    }

    async listSurfaceRevisions(args) {
        try {
            const { surface_id } = args;
            const surface = await this.surfaceManager.getSurface(surface_id);
            if (!surface) {
                return `[error] list_surface_revisions: surface '${surface_id}' not found. Use: list_surfaces to see available surfaces.`;
            }

            const revisions = await this.surfaceManager.listRevisions(surface_id);

            if (revisions.length === 0) {
                return `No revisions found for surface '${surface.name}'. Revisions are created automatically when components or layout are modified.`;
            }

            const lines = revisions.map(r =>
                `  rev ${r.revision} | ${r.timestamp} | ${r.action} (${r.componentCount} components)`
            );
            return `Revisions for '${surface.name}' (${revisions.length} total):\n${lines.join('\n')}`;
        } catch (error) {
            return `[error] list_surface_revisions: ${error.message}`;
        }
    }

    async revertSurface(args) {
        try {
            const { surface_id, revision } = args;
            const surface = await this.surfaceManager.getSurface(surface_id);
            if (!surface) {
                return `[error] revert_surface: surface '${surface_id}' not found. Use: list_surfaces to see available surfaces.`;
            }

            const restored = await this.surfaceManager.revertToRevision(surface_id, revision);

            if (this.eventBus) {
                this.eventBus.emit('surface:reverted', {
                    surfaceId: surface_id,
                    revision,
                    surface: restored
                });
            }

            const compNames = restored.components.map(c => c.name).join(', ') || '(none)';
            return `Surface '${restored.name}' reverted to revision ${revision}.\nRestored components: ${compNames}`;
        } catch (error) {
            return `[error] revert_surface: ${error.message}. Use: list_surface_revisions to see available revisions.`;
        }
    }
}
