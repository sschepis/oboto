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
            return `Error creating surface: ${error.message}`;
        }
    }

    async updateSurfaceComponent(args) {
        try {
            const { surface_id, component_name, jsx_source, props, order } = args;
            const surface = await this.surfaceManager.updateComponent(surface_id, component_name, jsx_source, props, order);
            
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

            return `Component '${component_name}' updated on surface '${surface.name}'.`;
        } catch (error) {
            return `Error updating component: ${error.message}`;
        }
    }

    async removeSurfaceComponent(args) {
        try {
            const { surface_id, component_name } = args;
            const success = await this.surfaceManager.removeComponent(surface_id, component_name);
            
            if (!success) {
                return `Component '${component_name}' not found on surface '${surface_id}'.`;
            }

            if (this.eventBus) {
                this.eventBus.emit('surface:updated', { 
                    surfaceId: surface_id, 
                    component: { name: component_name, deleted: true }
                });
            }

            return `Component '${component_name}' removed from surface.`;
        } catch (error) {
            return `Error removing component: ${error.message}`;
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
            return `Error listing surfaces: ${error.message}`;
        }
    }

    async deleteSurface(args) {
        try {
            const { surface_id } = args;
            const success = await this.surfaceManager.deleteSurface(surface_id);
            
            if (!success) {
                return `Surface '${surface_id}' not found.`;
            }

            if (this.eventBus) {
                this.eventBus.emit('surface:deleted', { surfaceId: surface_id });
            }

            return `Surface '${surface_id}' deleted successfully.`;
        } catch (error) {
            return `Error deleting surface: ${error.message}`;
        }
    }

    async openSurface(args) {
        try {
            const { surface_id } = args;
            const surface = await this.surfaceManager.getSurface(surface_id);
            
            if (!surface) {
                return `Surface '${surface_id}' not found.`;
            }

            if (this.eventBus) {
                this.eventBus.emit('surface:opened', { surfaceId: surface_id, surface });
            }

            return `Surface '${surface.name}' (ID: ${surface_id}) opened successfully.`;
        } catch (error) {
            return `Error opening surface: ${error.message}`;
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
                    return `Unknown preset '${preset}'. Available: ${Object.keys(SurfaceHandlers.LAYOUT_PRESETS).join(', ')}`;
                }
                // Deep clone to avoid mutation
                resolvedLayout = JSON.parse(JSON.stringify(resolvedLayout));
            } else if (layout) {
                if (!layout.type || layout.type !== 'flex-grid') {
                    return "Custom layout must have type: 'flex-grid' and a 'rows' array.";
                }
                resolvedLayout = layout;
            } else {
                return "Either 'preset' or 'layout' must be provided.";
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
            return `Error configuring layout: ${error.message}`;
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
            return `Error placing component: ${error.message}`;
        }
    }

    async captureSurface(args) {
        try {
            const { surface_id } = args;
            const surface = await this.surfaceManager.getSurface(surface_id);
            
            if (!surface) {
                return `Surface '${surface_id}' not found.`;
            }

            if (!this.eventBus) {
                return "Event bus not available to request screenshot.";
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
}
