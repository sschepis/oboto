import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Scans the workspace for JavaScript files exporting a 'route' function
 * and binds them to the Express app.
 * 
 * Disabled by default. Set OBOTO_DYNAMIC_ROUTES=true to enable.
 * Only scans routes/ and api/ directories for security.
 * 
 * @param {import('express').Application} app 
 * @param {string} workingDir 
 */
export async function mountDynamicRoutes(app, workingDir) {
    // Opt-in only — dynamic route loading executes arbitrary JS from the workspace
    if (process.env.OBOTO_DYNAMIC_ROUTES !== 'true') {
        consoleStyler.log('system', 'Dynamic routes disabled (set OBOTO_DYNAMIC_ROUTES=true to enable)');
        return;
    }
    
    consoleStyler.log('system', 'Scanning for dynamic routes...');
    
    const routes = [];
    
    // Only scan designated route directories, NOT the workspace root
    // This prevents importing application files (ai.mjs, etc.)
    // which cause side-effect noise during startup
    const ROUTE_DIRS = ['routes', 'api'];
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'ui', 'src', 'scripts', 'chrome-extension', 'tray-app', 'docs', 'plans', 'logs', 'puppeteer_data', 'skills']);
    
    async function scan(dir, isRoot = false) {
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relPath = path.relative(workingDir, fullPath);
                
                if (entry.isDirectory()) {
                    // Skip common ignore directories
                    if (SKIP_DIRS.has(entry.name)) continue;
                    
                    // Also skip hidden directories generally (except .well-known maybe?)
                    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
                    
                    await scan(fullPath, false);
                } else if (!isRoot && entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
                    // Determine route path
                    // e.g. foo/bar.js -> /foo/bar
                    // e.g. foo/index.js -> /foo
                    
                    let routePath = '/' + relPath.replace(/\\/g, '/').replace(/\.(m?js)$/, '');
                    
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
                        // Only log if it looked like it might be a route file but failed
                        // Use debug level if we had one, but warning is okay for now
                        // consoleStyler.log('warning', `  Failed to load ${relPath}: ${err.message}`);
                    }
                }
            }
        } catch (e) {
            consoleStyler.log('warning', `Failed to scan directory ${dir}: ${e.message}`);
        }
    }
    
    // First scan known route directories
    for (const routeDir of ROUTE_DIRS) {
        const routePath = path.join(workingDir, routeDir);
        if (fs.existsSync(routePath)) {
            await scan(routePath, false);
        }
    }
    
    // Only scan designated route directories (routes/, api/) for security.
    // Arbitrary workspace subdirectories are NOT scanned to prevent code injection.
    
    if (routes.length > 0) {
        consoleStyler.log('system', `✓ Mounted ${routes.length} dynamic routes`);
    } else {
        consoleStyler.log('system', 'No dynamic routes found');
    }
}
