import express from 'express';
import path from 'path';
import fs from 'fs';
import { consoleStyler } from '../ui/console-styler.mjs';
import { localhostCors } from './cors-middleware.mjs';
import { createDynamicRouteController } from './dynamic-router.mjs';
import { WorkspaceServerLog } from './workspace-server-log.mjs';

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class WorkspaceContentServer {
    constructor() {
        this.app = null;
        this.server = null;
        this.port = null;
        this.workspaceRoot = null;
        /** @private @type {WorkspaceServerLog|null} */
        this._serverLog = null;
        /** @private @type {Object|null} — parsed .oboto.json workspace config */
        this._workspaceConfig = null;
        /** @private @type {{ reload: Function, getRoutes: Function }|null} */
        this._routeController = null;
    }

    /**
     * Start the workspace content server on a random free port.
     * @param {string} workspaceRoot - The root directory of the current workspace.
     * @returns {Promise<number>} - The port number the server is listening on.
     */
    async start(workspaceRoot) {
        if (this.server) {
            await this.stop();
        }

        this.workspaceRoot = workspaceRoot;
        this.app = express();
        
        // Create server log instance
        this._serverLog = new WorkspaceServerLog(workspaceRoot);

        // Load workspace config
        this._workspaceConfig = await this._loadWorkspaceConfig(workspaceRoot);

        this.app.use(localhostCors());

        // Request logging middleware — unified: logs errors and normal requests
        this.app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                if (res.locals._serverError) {
                    this._serverLog?.logError(req.method, req.originalUrl, res.locals._serverError, duration);
                } else {
                    this._serverLog?.logRequest(req.method, req.originalUrl, res.statusCode, duration);
                }
            });
            next();
        });

        this.applyDefaultRoutes(this.app, workspaceRoot);

        // Mount dynamic routes from workspace routes/, .routes/, api/ directories
        // Uses a swappable sub-router so routes can be hot-reloaded without restarting.
        try {
            this._routeController = await createDynamicRouteController(this.app, workspaceRoot);
        } catch (e) {
            consoleStyler.log('warning', `Failed to mount dynamic routes: ${e.message}`);
        }

        // Error handling middleware (must be after all routes)
        // Stashes the error on res.locals so the finish listener logs it once
        this.app.use((err, req, res, next) => {
            res.locals._serverError = err;
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(0, () => {
                this.port = this.server.address().port;
                consoleStyler.log('system', `Workspace content server running on port ${this.port}`);
                resolve(this.port);
            });
            this.server.on('error', (err) => {
                consoleStyler.log('error', `Failed to start workspace content server: ${err.message}`);
                reject(err);
            });
        });
    }

    async stop() {
        if (this._serverLog) {
            this._serverLog.destroy();
            this._serverLog = null;
        }
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    consoleStyler.log('system', 'Workspace content server stopped');
                    this.server = null;
                    this.app = null;
                    this.port = null;
                    resolve();
                });
            });
        }
    }

    getPort() {
        return this.port;
    }

    /**
     * Hot-reload dynamic routes from workspace route directories.
     * Re-scans routes/, .routes/, and api/ and atomically swaps the route table.
     *
     * @returns {Promise<{ mounted: number, routes: string[] }>}
     */
    async reloadRoutes() {
        if (!this._routeController) {
            return { mounted: 0, routes: [], error: 'No route controller available (server not started or routes disabled)' };
        }
        return this._routeController.reload();
    }

    /**
     * Get list of currently mounted dynamic route paths.
     * @returns {string[]}
     */
    getRoutes() {
        return this._routeController?.getRoutes() || [];
    }

    /**
     * Return the WorkspaceServerLog instance for this server.
     * @returns {WorkspaceServerLog|null}
     */
    getServerLog() {
        return this._serverLog;
    }

    /**
     * Return the surface sandbox mode from workspace config.
     * @returns {'strict'|'permissive'}
     */
    getSurfaceSandboxMode() {
        const mode = this._workspaceConfig?.surface?.sandboxMode;
        return mode === 'permissive' ? 'permissive' : 'strict';
    }

    /**
     * Load .oboto.json workspace config from the workspace root.
     * @private
     * @param {string} workspaceRoot
     * @returns {Promise<Object|null>}
     */
    async _loadWorkspaceConfig(workspaceRoot) {
        const configPath = path.join(workspaceRoot, '.oboto.json');
        if (fs.existsSync(configPath)) {
            try {
                const content = await fs.promises.readFile(configPath, 'utf8');
                return JSON.parse(content);
            } catch (e) {
                consoleStyler.log('warning', `Failed to load .oboto.json: ${e.message}`);
            }
        }
        return null;
    }

    applyDefaultRoutes(app, workspaceRoot) {
        // Serve generated images at /images/
        const imagesPath = path.join(workspaceRoot, 'public', 'generated-images');
        if (!fs.existsSync(imagesPath)) {
            try {
                fs.mkdirSync(imagesPath, { recursive: true });
            } catch (e) {
                consoleStyler.log('warning', `Failed to create generated images directory: ${e.message}`);
            }
        }
        app.use('/images', express.static(imagesPath));
        // Add index for images
        app.get('/images/', (req, res) => this.serveDirectoryIndex(req, res, imagesPath, 'Generated Images'));

        // Serve public folder at root (optional but good practice)
        const publicPath = path.join(workspaceRoot, 'public');
        if (fs.existsSync(publicPath)) {
            app.use(express.static(publicPath));
        }
        
        // Root index
        app.get('/', (req, res) => this.serveRootIndex(req, res, workspaceRoot, publicPath));

        // Serve workspace files (media, etc.) via HTTP for streaming support
        app.get('/workspace-file/*filePath', (req, res) => {
            const relativePath = req.params.filePath;
            if (!relativePath) return res.status(400).json({ error: 'No file path specified' });
            const fullPath = path.resolve(workspaceRoot, relativePath);
            // Path traversal protection (also allow exact match for workspace root)
            const resolvedRoot = path.resolve(workspaceRoot);
            if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
                return res.status(403).json({ error: 'Access denied' });
            }
            if (!fs.existsSync(fullPath)) {
                return res.status(404).json({ error: 'File not found' });
            }
            res.sendFile(fullPath);
        });

        // Serve Surface API & HTML
        app.get('/api/surface/:id', (req, res) => this.handleSurfaceApi(req, res));
        app.get('/surface/:id', (req, res) => this.handleSurfaceHtml(req, res));
    }

    async serveDirectoryIndex(req, res, dirPath, title) {
        if (!fs.existsSync(dirPath)) return res.status(404).send('Not Found');
        
        try {
            const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
            const list = files.map(dirent => {
                const name = dirent.name;
                const isDir = dirent.isDirectory();
                const link = name + (isDir ? '/' : '');
                return `<li><a href="${link}" class="${isDir ? 'dir' : 'file'}">${isDir ? '📁' : '📄'} ${name}</a></li>`;
            }).join('');
            
            res.send(`
                <html>
                <head>
                    <title>Index of ${title}</title>
                    <style>
                        body { font-family: system-ui, sans-serif; padding: 2rem; background: #111; color: #ccc; }
                        h1 { color: #fff; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
                        ul { list-style: none; padding: 0; }
                        li { margin: 0.5rem 0; padding: 0.5rem; background: #1a1a1a; border-radius: 4px; }
                        li:hover { background: #222; }
                        a { color: #4af; text-decoration: none; font-size: 1.1rem; display: block; }
                        a:hover { text-decoration: underline; }
                        .dir { color: #fa4; font-weight: bold; }
                        .file { color: #cdf; }
                    </style>
                </head>
                <body>
                    <h1>Index of ${title}</h1>
                    <ul>
                        <li><a href=".." class="dir">📁 ..</a></li>
                        ${list}
                    </ul>
                </body>
                </html>
            `);
        } catch (e) {
            res.status(500).send('Error listing directory');
        }
    }

    async serveRootIndex(req, res, workspaceRoot, publicPath) {
        // Collect surfaces
        const surfacesDir = path.join(workspaceRoot, '.surfaces');
        let surfaces = [];
        if (fs.existsSync(surfacesDir)) {
            try {
                const files = await fs.promises.readdir(surfacesDir);
                for (const file of files) {
                    if (file.endsWith('.sur')) {
                        const content = await fs.promises.readFile(path.join(surfacesDir, file), 'utf8');
                        const data = JSON.parse(content);
                        surfaces.push({ id: data.id || file.replace('.sur', ''), name: data.name || 'Untitled' });
                    }
                }
            } catch (e) {}
        }

        // Collect public files
        let publicFiles = [];
        if (fs.existsSync(publicPath)) {
            try {
                const files = await fs.promises.readdir(publicPath, { withFileTypes: true });
                publicFiles = files.map(d => ({ 
                    name: d.name, 
                    isDir: d.isDirectory(),
                    link: d.name + (d.isDirectory() ? '/' : '')
                }));
            } catch (e) {}
        }

        const surfacesList = surfaces.map(s => `<li><a href="/surface/${s.id}" class="surface">🎨 ${s.name}</a> <span style="font-size:0.8em;color:#666">(${s.id})</span></li>`).join('');
        const filesList = publicFiles.map(f => `<li><a href="${f.link}" class="${f.isDir ? 'dir' : 'file'}">${f.isDir ? '📁' : '📄'} ${f.name}</a></li>`).join('');

        res.send(`
            <html>
            <head>
                <title>Workspace Root</title>
                <style>
                    body { font-family: system-ui, sans-serif; padding: 2rem; background: #111; color: #ccc; max-width: 800px; margin: 0 auto; }
                    h1, h2 { color: #fff; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
                    ul { list-style: none; padding: 0; }
                    li { margin: 0.5rem 0; padding: 0.5rem; background: #1a1a1a; border-radius: 4px; }
                    li:hover { background: #222; }
                    a { color: #4af; text-decoration: none; font-size: 1.1rem; display: block; }
                    .surface { color: #f7a; font-weight: bold; }
                    .dir { color: #fa4; font-weight: bold; }
                    .file { color: #cdf; }
                    .section { margin-bottom: 2rem; }
                </style>
            </head>
            <body>
                <h1>Workspace Content</h1>
                
                <div class="section">
                    <h2>Surfaces</h2>
                    <ul>
                        ${surfaces.length ? surfacesList : '<li><span style="color:#666">No surfaces found</span></li>'}
                    </ul>
                </div>

                <div class="section">
                    <h2>Files & Directories</h2>
                    <ul>
                        <li><a href="/images/" class="dir">🖼️ Generated Images (/images/)</a></li>
                        ${filesList}
                    </ul>
                </div>
            </body>
            </html>
        `);
    }

    async handleSurfaceApi(req, res, surfaceIdOverride) {
        const surfaceId = surfaceIdOverride || req.params.id;
        const surfacesDir = path.join(this.workspaceRoot, '.surfaces');
        const surfacePath = path.join(surfacesDir, `${surfaceId}.sur`);

        if (fs.existsSync(surfacePath)) {
            try {
                const content = await fs.promises.readFile(surfacePath, 'utf8');
                res.json(JSON.parse(content));
            } catch (e) {
                res.status(500).json({ error: 'Failed to read surface file' });
            }
        } else {
            res.status(404).json({ error: 'Surface not found' });
        }
    }

    async handleSurfaceHtml(req, res, surfaceIdOverride) {
        const surfaceId = surfaceIdOverride || req.params.id;
        const surfacesDir = path.join(this.workspaceRoot, '.surfaces');
        const surfacePath = path.join(surfacesDir, `${surfaceId}.sur`);
        
        let surfaceData = null;
        if (fs.existsSync(surfacePath)) {
            try {
                surfaceData = JSON.parse(await fs.promises.readFile(surfacePath, 'utf8'));
            } catch (e) {}
        }

        if (!surfaceData) {
            return res.status(404).send(`
                <html><body style="background:#111;color:#fff;font-family:sans-serif;padding:2rem;">
                <h1>404 Surface Not Found</h1>
                <p>ID: ${escapeHtml(surfaceId)}</p>
                </body></html>
            `);
        }

        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Surface: ${escapeHtml(surfaceData.name || surfaceId)}</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #fff; padding: 2rem; }
        pre { background: #333; padding: 1rem; border-radius: 4px; overflow: auto; }
        .card { background: #2a2a2a; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
        .component { border-left: 4px solid #4CAF50; padding-left: 1rem; margin-bottom: 0.5rem; }
    </style>
</head>
<body>
    <div id="content">
        <div class="card">
            <h2 id="surface-name">${escapeHtml(surfaceData.name || 'Untitled')}</h2>
            <p id="surface-desc">${escapeHtml(surfaceData.description || '')}</p>
        </div>
        
        <h3>Components</h3>
        <div id="components-list"></div>
        
        <h3>Raw Data</h3>
        <pre id="raw-data"></pre>
    </div>

    <script>
        const data = ${JSON.stringify(surfaceData).replace(/</g, '\\u003c')};
        
        const comps = data.components || [];
        const compsContainer = document.getElementById('components-list');
        
        if (comps.length === 0) {
            compsContainer.textContent = 'No components on this surface.';
        } else {
            comps.forEach(c => {
                const div = document.createElement('div');
                div.className = 'component';
                const nameEl = document.createElement('strong');
                nameEl.textContent = c.name;
                div.appendChild(nameEl);
                if (c.props && Object.keys(c.props).length > 0) {
                    const pre = document.createElement('pre');
                    pre.style.cssText = 'margin-top:0.5rem;font-size:0.8em';
                    pre.textContent = JSON.stringify(c.props, null, 2);
                    div.appendChild(pre);
                }
                compsContainer.appendChild(div);
            });
        }
        
        document.getElementById('raw-data').textContent = JSON.stringify(data, null, 2);
    </script>
</body>
</html>`;
        res.send(html);
    }

    resolveImagePath(filename) {
        return `/images/${filename}`;
    }
}
