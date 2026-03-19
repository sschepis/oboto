import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { consoleStyler } from '../ui/console-styler.mjs';

const MAX_REVISIONS = 50;

/** Maximum number of console log entries stored per surface. */
const MAX_CONSOLE_LOGS = 100;

/**
 * SurfaceManager handles the persistence and retrieval of Surface metadata and component source code.
 * Surfaces are stored in .surfaces/ directory in the workspace.
 *
 * Revision system: Every mutation creates an automatic snapshot in
 * `.surfaces/{id}.revisions/rev-NNN.json`. Each snapshot contains the full
 * surface metadata + all component sources inline, enabling instant rollback.
 */
export class SurfaceManager {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.surfacesDir = path.join(workspaceRoot, '.surfaces');
        this._initialized = false;
        /** @private In-memory ring buffers for console logs (surfaceId → entries[]) */
        this._consoleLogCache = new Map();
    }

    // ─── Known-bad UI components that cause React Error #130 ────────
    static BAD_COMPONENTS = {
        'UI.AlertTitle': 'Use <div className="font-semibold"> inside UI.Alert',
        'UI.AlertDescription': 'Use <div className="text-sm"> inside UI.Alert',
        'UI.Stack': 'Use <div className="flex flex-col gap-2">',
        'UI.Icons.Atom': 'Use UI.Icons.Activity instead',
        'UI.Icons.Orbit': 'Use UI.Icons.RefreshCw instead',
        'UI.Icons.Cpu': 'Use UI.Icons.Terminal instead',
    };

    /**
     * Validate JSX source code before writing to disk.
     * Catches the most common errors that cause surface render failures:
     *   - Missing export default function
     *   - Import statements (sandbox doesn't support them)
     *   - Non-existent UI components
     *   - Unbalanced braces/brackets
     *   - Empty source
     *
     * @param {string} jsxSource - The JSX source to validate
     * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
     */
    static validateJsxSource(jsxSource) {
        const errors = [];
        const warnings = [];

        // 1. Must not be empty
        if (!jsxSource || !jsxSource.trim()) {
            errors.push('jsx_source is empty');
            return { valid: false, errors, warnings };
        }

        const trimmed = jsxSource.trim();

        // 2. Must export a default function component
        if (!/export\s+default\s+function\b/.test(trimmed)) {
            errors.push(
                'Missing "export default function ComponentName(...)". ' +
                'Every surface component must export a default function component.'
            );
        }

        // 3. Must not use import statements (sandbox globals provide everything)
        const importMatch = trimmed.match(/^import\s+.+from\s+['"].+['"]/m);
        if (importMatch) {
            errors.push(
                `Found import statement: "${importMatch[0]}". ` +
                'Surface components cannot use imports — React, useState, useEffect, ' +
                'UI.*, surfaceApi, and useSurfaceLifecycle are all globals.'
            );
        }

        // 4. Check for non-existent UI components
        for (const [bad, fix] of Object.entries(SurfaceManager.BAD_COMPONENTS)) {
            if (trimmed.includes(bad)) {
                errors.push(`"${bad}" does not exist and will cause React Error #130. Fix: ${fix}`);
            }
        }

        // 5. Check for balanced braces/brackets (skip strings and template literals)
        let braceCount = 0, parenCount = 0, bracketCount = 0;
        let inString = false, stringChar = '', inTemplate = false, inLineComment = false, inBlockComment = false;
        let prevCh = '';
        for (let i = 0; i < trimmed.length; i++) {
            const ch = trimmed[i];

            // Handle comments
            if (!inString && !inTemplate) {
                if (inLineComment) {
                    if (ch === '\n') inLineComment = false;
                    continue;
                }
                if (inBlockComment) {
                    if (ch === '/' && prevCh === '*') inBlockComment = false;
                    continue;
                }
                if (ch === '/' && i + 1 < trimmed.length) {
                    if (trimmed[i + 1] === '/') { inLineComment = true; continue; }
                    if (trimmed[i + 1] === '*') { inBlockComment = true; continue; }
                }
            }

            // Handle strings
            if (!inTemplate && !inLineComment && !inBlockComment) {
                if (inString) {
                    if (ch === stringChar && prevCh !== '\\') inString = false;
                    continue;
                }
                if (ch === '"' || ch === "'") {
                    inString = true;
                    stringChar = ch;
                    continue;
                }
            }

            // Handle template literals
            if (!inString && !inLineComment && !inBlockComment) {
                if (ch === '`' && prevCh !== '\\') {
                    inTemplate = !inTemplate;
                    continue;
                }
                if (inTemplate) continue;
            }

            // Count brackets outside strings/comments/templates
            if (!inString && !inTemplate && !inLineComment && !inBlockComment) {
                if (ch === '{') braceCount++;
                else if (ch === '}') braceCount--;
                else if (ch === '(') parenCount++;
                else if (ch === ')') parenCount--;
                else if (ch === '[') bracketCount++;
                else if (ch === ']') bracketCount--;
            }

            prevCh = ch;
        }

        if (braceCount !== 0) {
            errors.push(
                `Unbalanced braces: ${braceCount > 0
                    ? braceCount + ' unclosed {'
                    : Math.abs(braceCount) + ' extra }'}`
            );
        }
        if (parenCount !== 0) {
            errors.push(
                `Unbalanced parentheses: ${parenCount > 0
                    ? parenCount + ' unclosed ('
                    : Math.abs(parenCount) + ' extra )'}`
            );
        }
        if (bracketCount !== 0) {
            warnings.push(
                `Unbalanced brackets: ${bracketCount > 0
                    ? bracketCount + ' unclosed ['
                    : Math.abs(bracketCount) + ' extra ]'}`
            );
        }

        // 6. Check for common React mistakes
        if (/\buseState\b/.test(trimmed) && !/\bconst\s+\[/.test(trimmed)) {
            warnings.push(
                'useState called but no array destructuring found. ' +
                'Pattern should be: const [value, setValue] = useState(initial)'
            );
        }

        // 7. Check for require() calls
        if (/\brequire\s*\(/.test(trimmed)) {
            errors.push(
                'Found require() call. Surface components run in a sandboxed environment — ' +
                'use the globally available APIs (UI.*, surfaceApi, React hooks) instead.'
            );
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
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
            consoleStyler.logError('error', 'Surface migration error', e);
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

        // Clean up in-memory console log cache
        this._consoleLogCache.delete(id);

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

        // Snapshot BEFORE the mutation so we can revert to this state
        await this._createRevision(surfaceId, surface, `update_component:${componentName}`);

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

        // Snapshot before removal
        await this._createRevision(surfaceId, surface, `remove_component:${componentName}`);

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

        await this._createRevision(id, surface, 'update_layout');

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

        await this._createRevision(surfaceId, surface, `place_component:${componentName}→${cellId}`);

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

    // ─── Revision System ─────────────────────────────────────────────

    /**
     * Return the revisions directory path for a surface.
     * @param {string} surfaceId
     * @returns {string}
     */
    _getRevisionsDir(surfaceId) {
        return path.join(this.surfacesDir, `${surfaceId}.revisions`);
    }

    /**
     * Collect all component JSX sources for a surface into a map.
     * @param {string} surfaceId
     * @param {object} surface Surface metadata (needs .components)
     * @returns {Promise<Record<string, string>>} componentName → source
     */
    async _collectComponentSources(surfaceId, surface) {
        const sources = {};
        for (const comp of surface.components) {
            try {
                const src = await fs.readFile(
                    path.join(this.surfacesDir, surfaceId, `${comp.name}.jsx`),
                    'utf8'
                );
                sources[comp.name] = src;
            } catch {
                // Component source may not exist yet (shouldn't happen, but be safe)
            }
        }
        return sources;
    }

    /**
     * Determine the next revision number by scanning existing rev files.
     * @param {string} revisionsDir
     * @returns {Promise<number>}
     */
    async _getNextRevisionNumber(revisionsDir) {
        try {
            const files = await fs.readdir(revisionsDir);
            let max = 0;
            for (const f of files) {
                const m = f.match(/^rev-(\d+)\.json$/);
                if (m) {
                    const n = parseInt(m[1], 10);
                    if (n > max) max = n;
                }
            }
            return max + 1;
        } catch {
            return 1;
        }
    }

    /**
     * Remove oldest revisions when count exceeds MAX_REVISIONS.
     * @param {string} revisionsDir
     */
    async _pruneRevisions(revisionsDir) {
        try {
            const files = (await fs.readdir(revisionsDir))
                .filter(f => /^rev-\d+\.json$/.test(f))
                .sort((a, b) => {
                    const na = parseInt(a.match(/\d+/)[0], 10);
                    const nb = parseInt(b.match(/\d+/)[0], 10);
                    return na - nb;
                });
            const excess = files.length - MAX_REVISIONS;
            if (excess > 0) {
                for (let i = 0; i < excess; i++) {
                    await fs.unlink(path.join(revisionsDir, files[i]));
                }
            }
        } catch {
            // ignore – directory may not exist yet
        }
    }

    /**
     * Create a revision snapshot for the given surface.
     * Called BEFORE a mutation is applied so the snapshot represents the
     * state the user can revert to.
     *
     * @param {string} surfaceId
     * @param {object} surface  Current surface metadata (pre-mutation)
     * @param {string} action   Human-readable label, e.g. "update_component:Header"
     */
    async _createRevision(surfaceId, surface, action) {
        const revDir = this._getRevisionsDir(surfaceId);
        await fs.mkdir(revDir, { recursive: true });

        const revNum = await this._getNextRevisionNumber(revDir);
        const sources = await this._collectComponentSources(surfaceId, surface);

        const snapshot = {
            revision: revNum,
            timestamp: new Date().toISOString(),
            action,
            surface: JSON.parse(JSON.stringify(surface)), // deep clone
            componentSources: sources
        };

        await fs.writeFile(
            path.join(revDir, `rev-${String(revNum).padStart(4, '0')}.json`),
            JSON.stringify(snapshot, null, 2)
        );

        await this._pruneRevisions(revDir);
    }

    /**
     * List all available revisions for a surface, newest-first.
     * @param {string} surfaceId
     * @returns {Promise<Array<{revision: number, timestamp: string, action: string}>>}
     */
    async listRevisions(surfaceId) {
        const revDir = this._getRevisionsDir(surfaceId);
        try {
            const files = (await fs.readdir(revDir))
                .filter(f => /^rev-\d+\.json$/.test(f))
                .sort((a, b) => {
                    const na = parseInt(a.match(/\d+/)[0], 10);
                    const nb = parseInt(b.match(/\d+/)[0], 10);
                    return nb - na; // newest first
                });

            const revisions = [];
            for (const f of files) {
                const content = JSON.parse(await fs.readFile(path.join(revDir, f), 'utf8'));
                revisions.push({
                    revision: content.revision,
                    timestamp: content.timestamp,
                    action: content.action,
                    componentCount: Object.keys(content.componentSources || {}).length
                });
            }
            return revisions;
        } catch {
            return [];
        }
    }

    /**
     * Revert a surface to a specific revision number.
     * Restores the surface metadata AND all component JSX sources.
     *
     * @param {string} surfaceId
     * @param {number} revisionNumber
     * @returns {Promise<object>} The restored surface metadata
     */
    async revertToRevision(surfaceId, revisionNumber) {
        const revDir = this._getRevisionsDir(surfaceId);
        const padded = String(revisionNumber).padStart(4, '0');
        const revFile = path.join(revDir, `rev-${padded}.json`);

        let snapshot;
        try {
            snapshot = JSON.parse(await fs.readFile(revFile, 'utf8'));
        } catch {
            throw new Error(`Revision ${revisionNumber} not found for surface ${surfaceId}`);
        }

        // Snapshot the CURRENT state before reverting (so revert itself is undoable)
        const currentSurface = await this.getSurface(surfaceId);
        if (currentSurface) {
            await this._createRevision(surfaceId, currentSurface, `revert_to:${revisionNumber}`);
        }

        const restoredSurface = snapshot.surface;
        restoredSurface.updatedAt = new Date().toISOString();

        // 1. Write restored metadata
        await fs.writeFile(
            path.join(this.surfacesDir, `${surfaceId}.sur`),
            JSON.stringify(restoredSurface, null, 2)
        );

        // 2. Restore component sources – remove existing, write snapshot's
        const compDir = path.join(this.surfacesDir, surfaceId);
        await fs.mkdir(compDir, { recursive: true });

        // Clear existing JSX files
        try {
            const existing = await fs.readdir(compDir);
            for (const f of existing) {
                if (f.endsWith('.jsx')) {
                    await fs.unlink(path.join(compDir, f));
                }
            }
        } catch {
            // ignore
        }

        // Write snapshot sources
        for (const [name, source] of Object.entries(snapshot.componentSources || {})) {
            await fs.writeFile(path.join(compDir, `${name}.jsx`), source);
        }

        return restoredSurface;
    }

    // ─── Client-side Error Tracking ───────────────────────────────────

    /**
     * Record a client-side component error (compile or render failure)
     * reported by the browser via WebSocket.
     *
     * Stored in surface metadata under `_clientErrors[componentName]` so
     * that subsequent readSurface / preRoute calls can surface them to
     * the agent.
     *
     * @param {string} surfaceId
     * @param {string} componentName
     * @param {string} errorMessage  The error message from the browser
     */
    async setComponentError(surfaceId, componentName, errorMessage) {
        const surface = await this.getSurface(surfaceId);
        if (!surface) return;

        if (!surface._clientErrors) surface._clientErrors = {};
        surface._clientErrors[componentName] = {
            message: errorMessage,
            timestamp: new Date().toISOString(),
        };
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${surfaceId}.sur`),
            JSON.stringify(surface, null, 2)
        );
    }

    /**
     * Clear a previously recorded client-side error for a component.
     * Called when a component renders successfully after a fix.
     *
     * @param {string} surfaceId
     * @param {string} componentName
     */
    async clearComponentError(surfaceId, componentName) {
        const surface = await this.getSurface(surfaceId);
        if (!surface || !surface._clientErrors) return;

        delete surface._clientErrors[componentName];
        if (Object.keys(surface._clientErrors).length === 0) {
            delete surface._clientErrors;
        }
        surface.updatedAt = new Date().toISOString();

        await fs.writeFile(
            path.join(this.surfacesDir, `${surfaceId}.sur`),
            JSON.stringify(surface, null, 2)
        );
    }

    /**
     * Get all client-side errors for a surface.
     * @param {string} surfaceId
     * @returns {Promise<Record<string, {message: string, timestamp: string}> | null>}
     */
    async getClientErrors(surfaceId) {
        const surface = await this.getSurface(surfaceId);
        if (!surface) return null;
        return surface._clientErrors || null;
    }

    // ─── Client-side Console Log Capture ──────────────────────────────

    /**
     * Append client-side console log entries for a surface component.
     * Entries are kept in an in-memory ring buffer (capped at
     * MAX_CONSOLE_LOGS) rather than persisted to the `.sur` file on every
     * batch.  This eliminates the full file read-modify-write cycle that
     * previously ran every 500 ms per active surface.
     *
     * Console logs are ephemeral diagnostic data — losing them on server
     * restart is acceptable and preferable to the I/O cost of persisting.
     *
     * @param {string} surfaceId
     * @param {string} componentName
     * @param {Array<{level: string, args: string[], timestamp: number}>} entries
     */
    appendConsoleLogs(surfaceId, componentName, entries) {
        if (!entries || entries.length === 0) return;

        let buf = this._consoleLogCache.get(surfaceId);
        if (!buf) {
            buf = [];
            this._consoleLogCache.set(surfaceId, buf);
        }

        // Tag each entry with the component name
        for (const entry of entries) {
            buf.push({
                component: componentName,
                level: entry.level,
                args: entry.args,
                timestamp: entry.timestamp,
            });
        }

        // Enforce ring buffer limit
        if (buf.length > MAX_CONSOLE_LOGS) {
            buf.splice(0, buf.length - MAX_CONSOLE_LOGS);
        }
    }

    /**
     * Get recent console logs for a surface.
     * @param {string} surfaceId
     * @param {number} [limit=50] Maximum entries to return (most recent)
     * @returns {Array<{component: string, level: string, args: string[], timestamp: number}>}
     */
    getConsoleLogs(surfaceId, limit = 50) {
        const buf = this._consoleLogCache.get(surfaceId);
        if (!buf || buf.length === 0) return [];
        return buf.slice(-limit);
    }

    /**
     * Clear all console logs for a surface.
     * @param {string} surfaceId
     */
    clearConsoleLogs(surfaceId) {
        this._consoleLogCache.delete(surfaceId);
    }
}
