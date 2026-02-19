import express from 'express';
import path from 'path';
import fs from 'fs';
import { consoleStyler } from '../ui/console-styler.mjs';

export class WorkspaceContentServer {
    constructor() {
        this.app = null;
        this.server = null;
        this.port = null;
        this.workspaceRoot = null;
        this.routeMap = null;
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
        
        // Load optional route map
        this.routeMap = await this.loadRouteMap(workspaceRoot);

        // Enable CORS for main UI to fetch if needed
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });

        if (this.routeMap) {
            this.applyRouteMap(this.app, this.routeMap, workspaceRoot);
        } else {
            this.applyDefaultRoutes(this.app, workspaceRoot);
        }

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(0, () => {
                this.port = this.server.address().port;
                consoleStyler.log('system', `Workspace content server running on port ${this.port}`);
                if (this.routeMap) consoleStyler.log('system', '  (Using custom route map)');
                resolve(this.port);
            });
            this.server.on('error', (err) => {
                consoleStyler.log('error', `Failed to start workspace content server: ${err.message}`);
                reject(err);
            });
        });
    }

    async stop() {
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

    async loadRouteMap(workspaceRoot) {
        const mapPath = path.join(workspaceRoot, '.route-map.json');
        if (fs.existsSync(mapPath)) {
            try {
                const content = await fs.promises.readFile(mapPath, 'utf8');
                return JSON.parse(content);
            } catch (e) {
                consoleStyler.log('warning', `Failed to load .route-map.json: ${e.message}`);
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

        // Serve public folder at root (optional but good practice)
        const publicPath = path.join(workspaceRoot, 'public');
        if (fs.existsSync(publicPath)) {
            app.use(express.static(publicPath));
        }

        // Serve Surface API & HTML
        app.get('/api/surface/:id', (req, res) => this.handleSurfaceApi(req, res));
        app.get('/surface/:id', (req, res) => this.handleSurfaceHtml(req, res));
    }

    applyRouteMap(app, map, workspaceRoot) {
        consoleStyler.log('system', 'Applying custom route map from .route-map.json');
        const resolvePath = (p) => path.resolve(workspaceRoot, p);

        for (const [route, target] of Object.entries(map)) {
            // Wildcard handling: /foo/* -> bar/*
            if (route.endsWith('/*')) {
                const routePrefix = route.slice(0, -2); // remove /*
                const targetPath = target.endsWith('/*') ? target.slice(0, -2) : target;
                
                if (target.startsWith('surface:')) {
                     consoleStyler.log('warning', `Wildcard not supported for surface target: ${target}`);
                     continue;
                }

                const absTarget = resolvePath(targetPath);
                if (fs.existsSync(absTarget)) {
                    app.use(routePrefix, express.static(absTarget));
                    consoleStyler.log('system', `  Mapped ${route} -> ${targetPath}`);
                } else {
                    consoleStyler.log('warning', `  Target directory not found: ${targetPath}`);
                }
            } else {
                // Exact match
                if (target.startsWith('surface:')) {
                    const surfaceId = target.split(':')[1];
                    app.get(route, (req, res) => this.handleSurfaceHtml(req, res, surfaceId));
                    consoleStyler.log('system', `  Mapped ${route} -> Surface ${surfaceId}`);
                } else {
                    const absTarget = resolvePath(target);
                    if (fs.existsSync(absTarget)) {
                        app.get(route, (req, res) => res.sendFile(absTarget));
                        consoleStyler.log('system', `  Mapped ${route} -> File ${target}`);
                    } else {
                        consoleStyler.log('warning', `  Target file not found: ${target}`);
                    }
                }
            }
        }
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
                <p>ID: ${surfaceId}</p>
                </body></html>
            `);
        }

        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Surface: ${surfaceData.name || surfaceId}</title>
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
            <h2 id="surface-name">${surfaceData.name || 'Untitled'}</h2>
            <p id="surface-desc">${surfaceData.description || ''}</p>
        </div>
        
        <h3>Components</h3>
        <div id="components-list"></div>
        
        <h3>Raw Data</h3>
        <pre id="raw-data"></pre>
    </div>

    <script>
        const data = ${JSON.stringify(surfaceData)};
        
        const comps = data.components || [];
        const compsContainer = document.getElementById('components-list');
        
        if (comps.length === 0) {
            compsContainer.textContent = 'No components on this surface.';
        } else {
            comps.forEach(c => {
                const div = document.createElement('div');
                div.className = 'component';
                div.innerHTML = '<strong>' + c.name + '</strong>' + 
                    (c.props && Object.keys(c.props).length > 0 
                        ? '<pre style="margin-top:0.5rem;font-size:0.8em">' + JSON.stringify(c.props, null, 2) + '</pre>' 
                        : '');
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
        if (!this.routeMap) {
            return `/images/${filename}`;
        }

        // Try to find a mapping for public/generated-images
        for (const [route, target] of Object.entries(this.routeMap)) {
            // Check for exact directory match (with or without ./)
            const cleanTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
            if (cleanTarget === 'public/generated-images' || cleanTarget === './public/generated-images') {
                const cleanRoute = route.endsWith('/*') ? route.slice(0, -2) : route;
                return `${cleanRoute}/${filename}`;
            }
        }
        
        // Fallback: return default if no mapping found
        return `/images/${filename}`;
    }
}
