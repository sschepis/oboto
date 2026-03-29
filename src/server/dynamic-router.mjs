import express from 'express';
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

// ─── Next.js-style path segment mapping ──────────────────────────────────────
// Filename conventions (mirroring Next.js App/Pages Router):
//   [param]      → :param         (dynamic segment)
//   [...slug]    → *slug          (catch-all segment — matches one or more segments)
//   [[...slug]]  → *slug          (optional catch-all — handled by also mounting base path)
//   (group)      → (ignored)      (route group — stripped from URL, purely organizational)
//   index.js     → /              (index route)
//
// Express 5 / path-to-regexp 8.x uses *name for wildcard parameters (not :name*).
//
// Priority ordering (from highest to lowest):
//   1. Static segments           /users/settings
//   2. Dynamic segments          /users/[id]
//   3. Catch-all segments        /users/[...slug]
//   4. Optional catch-all        /users/[[...slug]]
//
// .routes/ takes priority over routes/ when both define the same path.

/**
 * Segment priority for sorting routes.
 * Lower numbers = higher priority (matched first).
 *
 * Express 5 syntax: dynamic = :param, wildcard/catch-all = *param
 */
function segmentPriority(segment) {
    if (segment.startsWith('*'))  return 3;  // catch-all / optional catch-all
    if (segment.startsWith(':'))  return 2;  // dynamic
    return 1;                                // static
}

/**
 * Compare two Express route paths for priority ordering.
 * More specific (static) routes come first; catch-alls come last.
 */
function compareRoutePriority(a, b) {
    const aParts = a.split('/').filter(Boolean);
    const bParts = b.split('/').filter(Boolean);

    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
        const ap = segmentPriority(aParts[i] || '');
        const bp = segmentPriority(bParts[i] || '');
        if (ap !== bp) return ap - bp;
    }
    // Prefer shorter (more specific) paths when priority is equal
    return aParts.length - bParts.length;
}

/**
 * Convert a file-system path segment to an Express route segment.
 *
 * Supported Next.js conventions (Express 5 / path-to-regexp 8.x syntax):
 *   [param]      → :param          (dynamic segment)
 *   [...param]   → *param          (catch-all, 1+ segments)
 *   [[...param]] → *param          (optional catch-all, base path also mounted separately)
 *   (group)      → null            (route group — stripped from URL)
 *
 * @param {string} segment - A single directory or file name segment (sans extension)
 * @returns {{ express: string|null, isOptionalCatchAll: boolean, isCatchAll: boolean }}
 */
function convertSegment(segment) {
    // Route group: (groupName) — alphanumeric, hyphens, underscores only
    if (/^\([\w-]+\)$/.test(segment)) {
        return { express: null, isOptionalCatchAll: false, isCatchAll: false };
    }

    // Optional catch-all: [[...paramName]]
    const optCatchAll = segment.match(/^\[\[\.\.\.(\w+)\]\]$/);
    if (optCatchAll) {
        return { express: `*${optCatchAll[1]}`, isOptionalCatchAll: true, isCatchAll: false };
    }

    // Catch-all: [...paramName]
    const catchAll = segment.match(/^\[\.\.\.(\w+)\]$/);
    if (catchAll) {
        return { express: `*${catchAll[1]}`, isOptionalCatchAll: false, isCatchAll: true };
    }

    // Dynamic segment: [paramName]
    const dynamic = segment.match(/^\[(\w+)\]$/);
    if (dynamic) {
        return { express: `:${dynamic[1]}`, isOptionalCatchAll: false, isCatchAll: false };
    }

    // Static segment
    return { express: segment, isOptionalCatchAll: false, isCatchAll: false };
}

/**
 * Convert a file path (relative to the route directory root) into an Express
 * route path using Next.js conventions (Express 5 / path-to-regexp 8.x syntax).
 *
 * Examples:
 *   items.mjs                      → /items
 *   index.mjs                      → /
 *   api/users/index.mjs            → /api/users
 *   api/users/[id].mjs             → /api/users/:id
 *   api/users/[id]/posts.mjs       → /api/users/:id/posts
 *   blog/[...slug].mjs             → /blog/*slug
 *   docs/[[...slug]].mjs           → /docs/*slug   (+ /docs without params)
 *   (admin)/dashboard.mjs          → /dashboard
 *
 * @param {string} relPath - File path relative to the route directory root
 * @returns {{ routePath: string, isOptionalCatchAll: boolean } | null}
 */
export function filePathToRoutePath(relPath) {
    // Normalize separators
    const normalized = relPath.replace(/\\/g, '/');

    // Remove file extension
    const withoutExt = normalized.replace(/\.(m?js|ts|cjs)$/, '');

    // Split into segments
    const rawSegments = withoutExt.split('/').filter(Boolean);

    const expressSegments = [];
    let isOptionalCatchAll = false;

    for (const seg of rawSegments) {
        const converted = convertSegment(seg);
        if (converted.express === null) {
            // Route group — skip this segment
            continue;
        }
        if (converted.isOptionalCatchAll) isOptionalCatchAll = true;
        expressSegments.push(converted.express);
    }

    // Handle index routes — strip trailing "index"
    if (expressSegments.length > 0 && expressSegments[expressSegments.length - 1] === 'index') {
        expressSegments.pop();
    }

    const routePath = '/' + expressSegments.join('/');
    return { routePath: routePath === '' ? '/' : routePath, isOptionalCatchAll };
}

/**
 * Create a request handler for a loaded route module.
 * Supports Next.js-style default exports and named method exports.
 *
 * A route file can export:
 *   1. `export default function handler(req, res) { ... }`
 *      — handles ALL HTTP methods
 *   2. `export function GET(req, res) { ... }`
 *      `export function POST(req, res) { ... }`
 *      — handles specific HTTP methods (Next.js App Router style)
 *   3. `export function route(req, res) { ... }`
 *      — legacy format, handles ALL HTTP methods
 *
 * @param {object} module - The imported module
 * @param {string} routePath - The computed route path (for error messages)
 * @returns {{ handler: Function, methods: string[] } | null}
 */
function createRouteHandler(module, routePath) {
    const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    const methodHandlers = {};

    // Check for named HTTP method exports (Next.js App Router style)
    for (const method of HTTP_METHODS) {
        if (typeof module[method] === 'function') {
            methodHandlers[method] = module[method];
        }
    }

    if (Object.keys(methodHandlers).length > 0) {
        // Method-specific handlers
        return {
            methods: Object.keys(methodHandlers),
            handler: async (req, res) => {
                const fn = methodHandlers[req.method];
                if (fn) {
                    await fn(req, res);
                } else {
                    res.status(405).json({
                        error: `Method ${req.method} not allowed`,
                        allowed: Object.keys(methodHandlers),
                    });
                }
            },
        };
    }

    // Check for default export
    const defaultHandler = module.default || module.route;
    if (typeof defaultHandler === 'function') {
        return {
            methods: ['ALL'],
            handler: async (req, res) => {
                await defaultHandler(req, res);
            },
        };
    }

    return null;
}

/**
 * Recursively discover all route files in a directory.
 *
 * @param {string} dir - Absolute directory to scan
 * @param {string} routeDirRoot - The root of the route directory (for computing relative paths)
 * @param {Set<string>} skipDirs - Directory names to skip
 * @returns {Promise<Array<{ filePath: string, relPath: string }>>}
 */
async function discoverRouteFiles(dir, routeDirRoot, skipDirs) {
    const results = [];

    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Skip blacklisted directories
                if (skipDirs.has(entry.name)) continue;
                // Skip hidden directories (except route groups and .well-known)
                if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;

                await discoverRouteFiles(fullPath, routeDirRoot, skipDirs).then(sub => results.push(...sub));
            } else if (entry.isFile() && /\.(m?js|ts|cjs)$/.test(entry.name)) {
                // Skip files starting with _ (private/layout/template files in Next.js)
                if (entry.name.startsWith('_')) continue;
                // Skip type definition files
                if (entry.name.endsWith('.d.ts')) continue;

                results.push({
                    filePath: fullPath,
                    relPath: path.relative(routeDirRoot, fullPath),
                });
            }
        }
    } catch (e) {
        // Directory doesn't exist or can't be read — silently skip
    }

    return results;
}

/**
 * Scan workspace route directories, build a Next.js-style route table,
 * and mount handlers on the Express app.
 *
 * Route directories scanned (in priority order):
 *   1. .routes/   (hidden, takes priority — container dir, path prefix stripped)
 *   2. routes/    (visible — container dir, path prefix stripped)
 *   3. api/       (namespace dir — "api" kept in URL path)
 *
 * When .routes/ and routes/ both define the same route path, .routes/ wins.
 *
 * @param {import('express').Application} app
 * @param {string} workingDir - Workspace root directory
 */
export async function mountDynamicRoutes(app, workingDir) {
    // ── Opt-out check ────────────────────────────────────────────────────────
    const wsConfig = await loadWorkspaceConfig(workingDir);
    const envOptOut = process.env.OBOTO_DYNAMIC_ROUTES === 'false';
    const configOptOut = wsConfig?.dynamicRoutes?.enabled === false;

    if (envOptOut || configOptOut) {
        consoleStyler.log('system', 'Dynamic routes disabled (opt-out via .oboto.json or OBOTO_DYNAMIC_ROUTES=false)');
        return;
    }

    const sortedRoutes = await _buildRouteTable(workingDir);
    _mountRoutes(app, sortedRoutes);
}

/**
 * Build the route table from workspace route directories.
 * Returns a sorted array of route entries ready for mounting.
 *
 * @param {string} workingDir - Workspace root directory
 * @returns {Promise<Array>} Sorted route entries
 */
async function _buildRouteTable(workingDir) {
    consoleStyler.log('system', 'Scanning for dynamic routes (Next.js-style)...');

    const SKIP_DIRS = new Set([
        'node_modules', '.git', 'dist', 'build', 'coverage', '.next',
        'ui', 'src', 'scripts', 'chrome-extension', 'tray-app',
        'docs', 'plans', 'logs', 'puppeteer_data', 'skills',
    ]);

    // routeTable maps routePath → { handler, methods, source, filePath }
    // We scan .routes first, then routes, then api.
    // .routes entries win over routes entries for the same path.
    const routeTable = new Map();

    /**
     * Process a single route directory.
     * @param {string} dirName - Directory name relative to workspace root
     * @param {boolean} isContainer - If true, strip dirName from URL path
     * @param {string} source - Label for logging ('dotRoutes', 'routes', 'api')
     */
    async function processRouteDir(dirName, isContainer, source) {
        const dirPath = path.join(workingDir, dirName);
        if (!fs.existsSync(dirPath)) return;

        const files = await discoverRouteFiles(dirPath, isContainer ? dirPath : workingDir, SKIP_DIRS);

        for (const { filePath, relPath } of files) {
            const result = filePathToRoutePath(relPath);
            if (!result) continue;

            const { routePath, isOptionalCatchAll } = result;

            // .routes takes priority — skip if already registered from higher-priority source
            if (routeTable.has(routePath)) {
                const existing = routeTable.get(routePath);
                if (source !== 'dotRoutes' && existing.source === 'dotRoutes') {
                    consoleStyler.log('system', `  Skipped ${relPath} (${source}) — overridden by .routes`);
                    continue;
                }
                if (source !== 'dotRoutes' && existing.source !== 'dotRoutes') {
                    consoleStyler.log('warning', `  Route conflict: ${routePath} defined in both ${existing.source}/ and ${source}/ — using ${source}/`);
                }
            }

            try {
                // Bust the ESM module cache by appending a unique query parameter.
                // Node.js caches ESM imports by URL — without cache-busting, re-imports
                // during hot-reload would return the stale module.
                const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
                const module = await import(fileUrl);
                const routeHandler = createRouteHandler(module, routePath);

                if (!routeHandler) {
                    consoleStyler.log('system', `  Skipped ${relPath}: no valid export (expected default, route, or HTTP method exports)`);
                    continue;
                }

                routeTable.set(routePath, {
                    routePath,
                    handler: routeHandler.handler,
                    methods: routeHandler.methods,
                    source,
                    filePath,
                    relPath: path.relative(workingDir, filePath),
                    isOptionalCatchAll,
                });
            } catch (err) {
                consoleStyler.log('system', `  Skipped ${relPath}: ${err.message}`);
            }
        }
    }

    // Scan in priority order: .routes → routes → api
    await processRouteDir('.routes', true, 'dotRoutes');
    await processRouteDir('routes', true, 'routes');
    await processRouteDir('api', false, 'api');

    // Sort by priority: static routes first, then dynamic, then catch-all
    return [...routeTable.values()].sort((a, b) =>
        compareRoutePriority(a.routePath, b.routePath)
    );
}

/**
 * Mount sorted route entries onto an Express app or router.
 *
 * @param {import('express').Application|import('express').Router} target
 * @param {Array} sortedRoutes
 */
function _mountRoutes(target, sortedRoutes) {
    for (const entry of sortedRoutes) {
        const { routePath, handler, methods, relPath, isOptionalCatchAll } = entry;

        const wrappedHandler = async (req, res, next) => {
            try {
                await handler(req, res);
            } catch (err) {
                consoleStyler.log('error', `Error in dynamic route ${routePath}: ${err.message}`);
                if (!res.headersSent) {
                    res.status(500).json({ error: err.message });
                }
            }
        };

        // Always use .all() so that method-specific handlers can return
        // a proper 405 for unsupported methods instead of falling through to 404.
        target.all(routePath, wrappedHandler);

        // For optional catch-all, also mount the base path without the wildcard param
        // Express 5 syntax: /docs/*slug → base path /docs
        if (isOptionalCatchAll) {
            const basePath = routePath.replace(/\/\*[\w]+$/, '') || '/';
            if (basePath !== routePath) {
                target.all(basePath, wrappedHandler);
                consoleStyler.log('system', `  Mapped ${basePath} -> ${relPath} (optional catch-all base)`);
            }
        }

        const methodLabel = methods.includes('ALL') ? 'ALL' : methods.join(',');
        consoleStyler.log('system', `  Mapped ${routePath} [${methodLabel}] -> ${relPath}`);
    }

    // Summary
    if (sortedRoutes.length > 0) {
        consoleStyler.log('warning', `⚠ Loading ${sortedRoutes.length} dynamic route(s) from workspace — these execute arbitrary JavaScript`);
        consoleStyler.log('system', `✓ Mounted ${sortedRoutes.length} dynamic routes (Next.js-style)`);
    } else {
        consoleStyler.log('system', 'No dynamic routes found');
    }
}

/**
 * Create a hot-reloadable dynamic route controller.
 *
 * Mounts a middleware wrapper on the Express app that delegates to a swappable
 * inner Router. Call `controller.reload()` to re-scan workspace route files
 * and rebuild all dynamic routes without restarting the server.
 *
 * @param {import('express').Application} app
 * @param {string} workingDir - Workspace root directory
 * @returns {Promise<{ reload: () => Promise<{ mounted: number, routes: string[] }>, getRoutes: () => string[] }>}
 */
export async function createDynamicRouteController(app, workingDir) {
    let innerRouter = express.Router();
    let routeList = [];

    // Mount the proxy middleware once — it forwards all requests to innerRouter.
    // Because the reference is captured in a closure, swapping innerRouter
    // instantly reroutes all traffic to the new routes.
    app.use((req, res, next) => {
        innerRouter(req, res, next);
    });

    // Check opt-out
    const wsConfig = await loadWorkspaceConfig(workingDir);
    const envOptOut = process.env.OBOTO_DYNAMIC_ROUTES === 'false';
    const configOptOut = wsConfig?.dynamicRoutes?.enabled === false;
    const disabled = envOptOut || configOptOut;

    if (disabled) {
        consoleStyler.log('system', 'Dynamic routes disabled (opt-out via .oboto.json or OBOTO_DYNAMIC_ROUTES=false)');
    } else {
        // Initial mount
        const sortedRoutes = await _buildRouteTable(workingDir);
        _mountRoutes(innerRouter, sortedRoutes);
        routeList = sortedRoutes.map(r => r.routePath);
    }

    return {
        /**
         * Hot-reload: re-scan workspace route directories, rebuild the route
         * table, and atomically swap the inner router.
         *
         * @returns {Promise<{ mounted: number, routes: string[] }>}
         */
        async reload() {
            consoleStyler.log('system', '♻ Hot-reloading dynamic routes...');
            const freshRouter = express.Router();
            const sortedRoutes = await _buildRouteTable(workingDir);
            _mountRoutes(freshRouter, sortedRoutes);

            // Atomic swap — no requests are lost
            innerRouter = freshRouter;
            routeList = sortedRoutes.map(r => r.routePath);

            consoleStyler.log('system', `♻ Hot-reload complete: ${routeList.length} route(s) active`);
            return { mounted: routeList.length, routes: routeList };
        },

        /** Get current list of active route paths. */
        getRoutes() {
            return [...routeList];
        },
    };
}
