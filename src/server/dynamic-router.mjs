import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Load .oboto.json workspace config from the workspace root.
 * @param {string} workspaceRoot
 * @returns {Promise<Object|null>}
 */
async function loadWorkspaceConfig(workspaceRoot) {
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

/**
 * Scans the workspace for JavaScript files exporting a 'route' function
 * and binds them to the Express app.
 *
 * **Enabled by default.** Opt out via OBOTO_DYNAMIC_ROUTES=false env var or
 * `{ "dynamicRoutes": { "enabled": false } }` in .oboto.json.
 * Only scans routes/, .routes/, and api/ directories for security.
 *
 * **Security note:** Dynamic routes execute arbitrary JavaScript from the
 * workspace.  The workspace content server runs on a separate port without
 * auth sessions, but route code still has access to process.env and the
 * filesystem.  Disable for untrusted workspaces.
 *
 * @param {import('express').Application} app
 * @param {string} workingDir
 */
export async function mountDynamicRoutes(app, workingDir) {
    // Enabled by default. Opt out explicitly for untrusted workspaces.
    const wsConfig = await loadWorkspaceConfig(workingDir);
    const envOptOut = process.env.OBOTO_DYNAMIC_ROUTES === 'false';
    const configOptOut = wsConfig?.dynamicRoutes?.enabled === false;

    if (envOptOut || configOptOut) {
        consoleStyler.log('system', 'Dynamic routes disabled (opt-out via .oboto.json or OBOTO_DYNAMIC_ROUTES=false)');
        return;
    }

    consoleStyler.log('system', 'Scanning for dynamic routes...');
    
    const routes = [];
    
    // Only scan designated route directories, NOT the workspace root
    // This prevents importing application files (ai.mjs, etc.)
    // which cause side-effect noise during startup
    //
    // Container directories (routes/, .routes/): the directory name is stripped
    //   from the URL path. e.g. routes/api/klines.mjs → /api/klines
    // Namespace directories (api/): the directory name IS part of the URL path.
    //   e.g. api/users/index.mjs → /api/users
    const CONTAINER_DIRS = ['routes', '.routes'];      // prefix stripped from route path
    const NAMESPACE_DIRS = ['api'];                     // prefix kept in route path
    const ROUTE_DIRS = [...CONTAINER_DIRS, ...NAMESPACE_DIRS];
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'ui', 'src', 'scripts', 'chrome-extension', 'tray-app', 'docs', 'plans', 'logs', 'puppeteer_data', 'skills']);
    
    async function scan(dir, routeDirRoot, isRoot = false) {
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relPath = path.relative(workingDir, fullPath);
                // Compute route path relative to the route directory root
                // e.g. for routes/api/klines.mjs scanned from routes/, the
                // routeRelPath is "api/klines.mjs" → route path "/api/klines"
                const routeRelPath = path.relative(routeDirRoot, fullPath);
                
                if (entry.isDirectory()) {
                    // Skip common ignore directories
                    if (SKIP_DIRS.has(entry.name)) continue;
                    
                    // Also skip hidden directories generally (except .well-known maybe?)
                    if (entry.name.startsWith('.') && entry.name !== '.well-known' && entry.name !== '.routes') continue;
                    
                    await scan(fullPath, routeDirRoot, false);
                } else if (!isRoot && entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
                    // Determine route path relative to the route directory root
                    // e.g. api/klines.mjs -> /api/klines
                    // e.g. index.mjs -> /
                    
                    let routePath = '/' + routeRelPath.replace(/\\/g, '/').replace(/\.(m?js)$/, '');
                    
                    if (routePath.endsWith('/index')) {
                        routePath = routePath.slice(0, -6); // Remove /index
                        if (routePath === '') routePath = '/';
                    }
                    
                    try {
                        // Import module
                        const fileUrl = pathToFileURL(fullPath).href;
                        const module = await import(fileUrl);
                        
                        if (typeof module.route === 'function') {
                            // Bind route
                            // We use app.all to capture all HTTP methods
                            app.all(routePath, async (req, res, next) => {
                                try {
                                    await module.route(req, res);
                                } catch (err) {
                                    consoleStyler.log('error', `Error in dynamic route ${routePath}: ${err.message}`);
                                    if (!res.headersSent) {
                                        res.status(500).json({ error: err.message });
                                    }
                                }
                            });
                            
                            consoleStyler.log('system', `  Mapped ${routePath} -> ${relPath}`);
                            routes.push(routePath);
                        }
                    } catch (err) {
                        // Log skipped files so users can diagnose route-loading issues
                        consoleStyler.log('system', `  Skipped ${relPath}: ${err.message}`);
                    }
                }
            }
        } catch (e) {
            consoleStyler.log('warning', `Failed to scan directory ${dir}: ${e.message}`);
        }
    }
    
    // First scan known route directories
    for (const routeDir of ROUTE_DIRS) {
        const routeDirPath = path.join(workingDir, routeDir);
        if (!fs.existsSync(routeDirPath)) continue;

        if (CONTAINER_DIRS.includes(routeDir)) {
            // Container: strip directory name from route path
            // routes/api/klines.mjs → routeRelPath "api/klines.mjs" → /api/klines
            await scan(routeDirPath, routeDirPath, false);
        } else {
            // Namespace: keep directory name in route path
            // api/users.mjs → routeRelPath "api/users.mjs" → /api/users
            await scan(routeDirPath, workingDir, false);
        }
    }
    
    // Only scan designated route directories (routes/, api/) for security.
    // Arbitrary workspace subdirectories are NOT scanned to prevent code injection.
    
    if (routes.length > 0) {
        consoleStyler.log('warning', `⚠ Loading ${routes.length} dynamic route(s) from workspace — these execute arbitrary JavaScript from: ${ROUTE_DIRS.join(', ')}`);
        consoleStyler.log('system', `✓ Mounted ${routes.length} dynamic routes`);
    } else {
        consoleStyler.log('system', 'No dynamic routes found');
    }
}
