import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * SurfaceManager handles the persistence and retrieval of Surface metadata and component source code.
 * Surfaces are stored in .surfaces/ directory in the workspace.
 */
export class SurfaceManager {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.surfacesDir = path.join(workspaceRoot, '.surfaces');
        this._initialized = false;
    }

    async _ensureInitialized() {
        if (this._initialized) return;

        try {
            await fs.mkdir(this.surfacesDir, { recursive: true });
        } catch (e) {
            // ignore
        }

        try {
            // Migration: Rename existing .json surface files to .sur
            const files = await fs.readdir(this.surfacesDir);
            for (const file of files) {
                if (file.endsWith('.json') && file !== '_index.json') {
                    const oldPath = path.join(this.surfacesDir, file);
                    const newPath = path.join(this.surfacesDir, file.replace('.json', '.sur'));
                    await fs.rename(oldPath, newPath);
                }
            }
        } catch (e) {
            console.error('Migration error:', e);
        }

        this._initialized = true;
    }

    /**
     * Create a new surface
     * @param {string} name 
     * @param {string} description 
     * @param {string} layout 
     */
    async createSurface(name, description, layout = 'vertical') {
        await this._ensureInitialized();

        const id = uuidv4();
        const now = new Date().toISOString();
        
        const surface = {
            id,
            name,
            description,
            layout,
            createdAt: now,
            updatedAt: now,
            pinned: false,
            theme: 'dark',
            components: []
        };

        // Write surface metadata
        await fs.writeFile(
            path.join(this.surfacesDir, `${id}.sur`),
            JSON.stringify(surface, null, 2)
        );

        // Create directory for component sources
        await fs.mkdir(path.join(this.surfacesDir, id), { recursive: true });

        return surface;
    }

    /**
     * Get a surface by ID
     * @param {string} id 
     */
    async getSurface(id) {
        await this._ensureInitialized();
        try {
            const content = await fs.readFile(path.join(this.surfacesDir, `${id}.sur`), 'utf8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    }

    /**
     * List all surfaces (by scanning .sur files)
     */
    async listSurfaces() {
        await this._ensureInitialized();
        try {
            const files = await fs.readdir(this.surfacesDir);
            const surFiles = files.filter(f => f.endsWith('.sur'));
            
            const surfaces = await Promise.all(surFiles.map(async file => {
                try {
                    const content = await fs.readFile(path.join(this.surfacesDir, file), 'utf8');
                    const data = JSON.parse(content);
                    // Return only metadata needed for list
                    return {
                        id: data.id,
                        name: data.name,
                        description: data.description,
                        layout: data.layout || 'vertical',
                        pinned: data.pinned,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt
                    };
                } catch (e) {
                    return null;
                }
            }));
            
            return surfaces.filter(s => s !== null);
        } catch (e) {
            return [];
        }
    }

    /**
     * Delete a surface
     * @param {string} id 
     */
    async deleteSurface(id) {
        await this._ensureInitialized();

        // Remove metadata file
        try {
            await fs.unlink(path.join(this.surfacesDir, `${id}.sur`));
        } catch (e) {}

        // Remove component sources directory
        try {
            await fs.rm(path.join(this.surfacesDir, id), { recursive: true, force: true });
        } catch (e) {}

        return true;
    }

    /**
     * Add or update a component on a surface
     * @param {string} surfaceId 
     * @param {string} componentName PascalCase name
     * @param {string} jsxSource Full source code
     * @param {object} props Optional props
     * @param {number} order Optional order
     */
    async updateComponent(surfaceId, componentName, jsxSource, props = {}, order = null) {
        const surface = await this.getSurface(surfaceId);
        if (!surface) throw new Error(`Surface ${surfaceId} not found`);

        const componentId = `comp-${componentName}`;
        const sourceFileName = `${componentName}.jsx`;
        const relativeSourcePath = path.join(surfaceId, sourceFileName);
        const fullSourcePath = path.join(this.surfacesDir, relativeSourcePath);

        // Write source file
        await fs.writeFile(fullSourcePath, jsxSource);

        // Update metadata
        const existingCompIndex = surface.components.findIndex(c => c.name === componentName);
        const isNewComponent = existingCompIndex < 0;
        
        if (existingCompIndex >= 0) {
            // Update existing
            surface.components[existingCompIndex] = {
                ...surface.components[existingCompIndex],
                props: { ...surface.components[existingCompIndex].props, ...props },
                updatedAt: new Date().toISOString()
            };
            if (order !== null) {
                surface.components[existingCompIndex].order = order;
            }
        } else {
            // Add new
            const newOrder = order !== null ? order : surface.components.length;
            surface.components.push({
                id: componentId,
                name: componentName,
                sourceFile: relativeSourcePath,
                props,
                order: newOrder,
                updatedAt: new Date().toISOString()
            });
        }

        // Auto-place new components into flex-grid cells if layout is flex-grid
        if (isNewComponent && surface.layout && typeof surface.layout === 'object' && surface.layout.type === 'flex-grid') {
            this._autoPlaceComponent(surface, componentName);
        }

        // Sort by order
        surface.components.sort((a, b) => a.order - b.order);
        surface.updatedAt = new Date().toISOString();

        // Save metadata
        await fs.writeFile(
            path.join(this.surfacesDir, `${surfaceId}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return surface;
    }

    /**
     * Remove a component from a surface
     */
    async removeComponent(surfaceId, componentName) {
        const surface = await this.getSurface(surfaceId);
        if (!surface) throw new Error(`Surface ${surfaceId} not found`);

        const compIndex = surface.components.findIndex(c => c.name === componentName);
        if (compIndex === -1) return false;

        // Remove source file
        try {
            const comp = surface.components[compIndex];
            const fullSourcePath = path.join(this.surfacesDir, comp.sourceFile);
            await fs.unlink(fullSourcePath);
        } catch (e) {
            // Ignore missing file
        }

        // Remove from metadata
        surface.components.splice(compIndex, 1);
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${surfaceId}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return true;
    }

    /**
     * Get the source code for a component
     * @param {string} surfaceId
     * @param {string} componentName
     */
    async getComponentSource(surfaceId, componentName) {
        try {
            const sourcePath = path.join(this.surfacesDir, surfaceId, `${componentName}.jsx`);
            return await fs.readFile(sourcePath, 'utf8');
        } catch (e) {
            return null;
        }
    }

    /**
     * Auto-place a component into the first cell with fewest components.
     * Distributes components evenly across available cells.
     * @param {object} surface The surface object (mutated in-place)
     * @param {string} componentName
     */
    _autoPlaceComponent(surface, componentName) {
        const layout = surface.layout;
        if (!layout || !layout.rows) return;

        // Collect all cells
        const allCells = [];
        for (const row of layout.rows) {
            for (const cell of row.cells) {
                allCells.push(cell);
            }
        }

        if (allCells.length === 0) return;

        // Check if already placed
        for (const cell of allCells) {
            if (cell.components.includes(componentName)) return;
        }

        // Pick the cell with fewest components (load-balance)
        let bestCell = allCells[0];
        for (const cell of allCells) {
            if (cell.components.length < bestCell.components.length) {
                bestCell = cell;
            }
        }

        bestCell.components.push(componentName);
    }

    /**
     * Update the layout configuration of a surface.
     * Supports legacy string layouts ('vertical', 'horizontal', 'grid') 
     * and the new flex-grid layout objects.
     * @param {string} id Surface ID
     * @param {string|object} layout Layout config – string or FlexGridLayout object
     */
    async updateLayout(id, layout) {
        const surface = await this.getSurface(id);
        if (!surface) throw new Error(`Surface ${id} not found`);

        surface.layout = layout;
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${id}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return surface;
    }

    /**
     * Place a component into a specific cell within a flex-grid layout.
     * If the layout is not a flex-grid, this is a no-op.
     * @param {string} surfaceId 
     * @param {string} componentName 
     * @param {string} cellId The target cell ID in the flex-grid
     */
    async placeComponentInCell(surfaceId, componentName, cellId) {
        const surface = await this.getSurface(surfaceId);
        if (!surface) throw new Error(`Surface ${surfaceId} not found`);
        if (!surface.layout || typeof surface.layout !== 'object' || surface.layout.type !== 'flex-grid') {
            throw new Error('Surface layout is not flex-grid');
        }

        // Find the target cell across all rows
        let targetCell = null;
        for (const row of surface.layout.rows) {
            for (const cell of row.cells) {
                if (cell.id === cellId) {
                    targetCell = cell;
                    break;
                }
            }
            if (targetCell) break;
        }

        if (!targetCell) throw new Error(`Cell ${cellId} not found in layout`);

        // Add component if not already there
        if (!targetCell.components.includes(componentName)) {
            targetCell.components.push(componentName);
        }

        surface.updatedAt = new Date().toISOString();
        await fs.writeFile(
            path.join(this.surfacesDir, `${surfaceId}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return surface;
    }

    /**
     * Rename a surface
     * @param {string} id Surface ID
     * @param {string} newName New name for the surface
     */
    async renameSurface(id, newName) {
        const surface = await this.getSurface(id);
        if (!surface) throw new Error(`Surface ${id} not found`);

        surface.name = newName;
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${id}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return surface;
    }

    /**
     * Duplicate a surface (deep copy including all components)
     * @param {string} id Source surface ID to duplicate
     * @param {string} [newName] Optional name for the duplicate (defaults to "Copy of <original>")
     */
    async duplicateSurface(id, newName) {
        const source = await this.getSurface(id);
        if (!source) throw new Error(`Surface ${id} not found`);

        const { v4: uuidv4Local } = await import('uuid');
        const newId = uuidv4Local();
        const now = new Date().toISOString();

        const duplicate = {
            ...source,
            id: newId,
            name: newName || `Copy of ${source.name}`,
            createdAt: now,
            updatedAt: now,
            pinned: false,
            components: source.components.map(c => ({
                ...c,
                id: `comp-${c.name}`,
                sourceFile: path.join(newId, `${c.name}.jsx`),
                updatedAt: now
            }))
        };

        // Write duplicate metadata
        await fs.writeFile(
            path.join(this.surfacesDir, `${newId}.sur`),
            JSON.stringify(duplicate, null, 2)
        );

        // Copy component source directory
        const srcDir = path.join(this.surfacesDir, id);
        const destDir = path.join(this.surfacesDir, newId);
        await fs.mkdir(destDir, { recursive: true });

        try {
            const files = await fs.readdir(srcDir);
            for (const file of files) {
                const srcFile = path.join(srcDir, file);
                const destFile = path.join(destDir, file);
                await fs.copyFile(srcFile, destFile);
            }
        } catch (e) {
            // Source dir may not exist if surface has no components
        }

        return duplicate;
    }

    /**
     * Get a state value from a surface's persisted state.
     * @param {string} id Surface ID
     * @param {string} key State key
     * @returns {*} The stored value, or undefined
     */
    async getSurfaceState(id, key) {
        const surface = await this.getSurface(id);
        if (!surface) return undefined;
        return surface.state?.[key];
    }

    /**
     * Set a state value in a surface's persisted state.
     * @param {string} id Surface ID
     * @param {string} key State key
     * @param {*} value Value to store
     */
    async setSurfaceState(id, key, value) {
        const surface = await this.getSurface(id);
        if (!surface) throw new Error(`Surface ${id} not found`);

        if (!surface.state) {
            surface.state = {};
        }
        surface.state[key] = value;
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${id}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return surface;
    }

    /**
     * Toggle pin status
     */
    async togglePin(id) {
        const surface = await this.getSurface(id);
        if (!surface) return false;

        surface.pinned = !surface.pinned;
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${id}.sur`),
            JSON.stringify(surface, null, 2)
        );

        return surface.pinned;
    }
}
