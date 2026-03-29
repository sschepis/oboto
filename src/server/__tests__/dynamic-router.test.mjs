/**
 * Tests for Next.js-style dynamic file-based routing.
 *
 * Run with: node --test src/server/__tests__/dynamic-router.test.mjs
 *
 * Covers:
 *   - filePathToRoutePath() — pure path conversion logic
 *   - mountDynamicRoutes() — full Express integration with priority ordering
 *   - .routes/ vs routes/ priority
 *   - Dynamic segments, catch-all, optional catch-all, route groups
 *   - Named HTTP method exports (GET, POST, etc.)
 *   - Default export and legacy `route` export
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';
import { filePathToRoutePath, mountDynamicRoutes } from '../dynamic-router.mjs';

// ─── Unit tests: filePathToRoutePath ─────────────────────────────────────────

describe('filePathToRoutePath()', () => {
    // Basic static routes
    it('simple file → /<name>', () => {
        assert.equal(filePathToRoutePath('items.mjs').routePath, '/items');
    });

    it('index file → /', () => {
        assert.equal(filePathToRoutePath('index.mjs').routePath, '/');
    });

    it('nested index → /api/users', () => {
        assert.equal(filePathToRoutePath('api/users/index.mjs').routePath, '/api/users');
    });

    it('nested file → /api/users/list', () => {
        assert.equal(filePathToRoutePath('api/users/list.mjs').routePath, '/api/users/list');
    });

    it('.js extension works', () => {
        assert.equal(filePathToRoutePath('data.js').routePath, '/data');
    });

    it('.ts extension works', () => {
        assert.equal(filePathToRoutePath('data.ts').routePath, '/data');
    });

    it('.cjs extension works', () => {
        assert.equal(filePathToRoutePath('data.cjs').routePath, '/data');
    });

    // Dynamic segments: [param]
    it('dynamic segment → /:param', () => {
        assert.equal(filePathToRoutePath('users/[id].mjs').routePath, '/users/:id');
    });

    it('nested dynamic segment → /users/:id/posts', () => {
        assert.equal(filePathToRoutePath('users/[id]/posts.mjs').routePath, '/users/:id/posts');
    });

    it('multiple dynamic segments → /users/:userId/posts/:postId', () => {
        assert.equal(filePathToRoutePath('users/[userId]/posts/[postId].mjs').routePath, '/users/:userId/posts/:postId');
    });

    it('dynamic segment as file name → /api/users/:id', () => {
        assert.equal(filePathToRoutePath('api/users/[id].mjs').routePath, '/api/users/:id');
    });

    // Catch-all: [...slug] — Express 5 uses *param syntax
    it('catch-all segment → /blog/*slug', () => {
        const result = filePathToRoutePath('blog/[...slug].mjs');
        assert.equal(result.routePath, '/blog/*slug');
        assert.equal(result.isOptionalCatchAll, false);
    });

    it('catch-all at root → /*path', () => {
        const result = filePathToRoutePath('[...path].mjs');
        assert.equal(result.routePath, '/*path');
        assert.equal(result.isOptionalCatchAll, false);
    });

    // Optional catch-all: [[...slug]] — Express 5 uses *param syntax
    it('optional catch-all segment → /docs/*slug (with optional flag)', () => {
        const result = filePathToRoutePath('docs/[[...slug]].mjs');
        assert.equal(result.routePath, '/docs/*slug');
        assert.equal(result.isOptionalCatchAll, true);
    });

    // Route groups: (groupName)
    it('route group stripped from path → /dashboard', () => {
        assert.equal(filePathToRoutePath('(admin)/dashboard.mjs').routePath, '/dashboard');
    });

    it('nested route group → /settings/profile', () => {
        assert.equal(filePathToRoutePath('(admin)/settings/profile.mjs').routePath, '/settings/profile');
    });

    it('multiple route groups → /page', () => {
        assert.equal(filePathToRoutePath('(marketing)/(landing)/page.mjs').routePath, '/page');
    });

    it('route group with dynamic segment → /:id', () => {
        assert.equal(filePathToRoutePath('(api)/[id].mjs').routePath, '/:id');
    });

    // Windows-style backslashes
    it('backslash separators normalized → /api/users', () => {
        assert.equal(filePathToRoutePath('api\\users\\index.mjs').routePath, '/api/users');
    });

    it('backslash with dynamic segment → /api/users/:id', () => {
        assert.equal(filePathToRoutePath('api\\users\\[id].mjs').routePath, '/api/users/:id');
    });

    // Edge cases
    it('deeply nested path → /a/b/c/d/e', () => {
        assert.equal(filePathToRoutePath('a/b/c/d/e.mjs').routePath, '/a/b/c/d/e');
    });
});

// ─── Integration tests: mountDynamicRoutes ───────────────────────────────────

describe('mountDynamicRoutes() integration', () => {
    let tmpDir;

    function createApp() {
        const app = express();
        app.use(express.json());
        return app;
    }

    function writeRouteFile(relPath, content) {
        const fullPath = path.join(tmpDir, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
    }

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-router-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('mounts a basic default-export route', async () => {
        writeRouteFile('routes/items.mjs', `
            export default function handler(req, res) {
                res.json({ items: ['a', 'b', 'c'] });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/items');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { items: ['a', 'b', 'c'] });
    });

    it('mounts a legacy route export', async () => {
        writeRouteFile('routes/legacy.mjs', `
            export async function route(req, res) {
                res.json({ legacy: true });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/legacy');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { legacy: true });
    });

    it('mounts named HTTP method exports', async () => {
        writeRouteFile('routes/users.mjs', `
            export function GET(req, res) {
                res.json({ method: 'GET', users: [] });
            }
            export function POST(req, res) {
                res.status(201).json({ method: 'POST', created: true });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const getRes = await request(app).get('/users');
        assert.equal(getRes.status, 200);
        assert.equal(getRes.body.method, 'GET');

        const postRes = await request(app).post('/users').send({ name: 'Test' });
        assert.equal(postRes.status, 201);
        assert.equal(postRes.body.method, 'POST');
    });

    it('returns 405 for unsupported HTTP method when using named exports', async () => {
        writeRouteFile('routes/only-get.mjs', `
            export function GET(req, res) {
                res.json({ ok: true });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).delete('/only-get');
        assert.equal(res.status, 405);
        assert.match(res.body.error, /not allowed/i);
    });

    it('mounts index routes correctly', async () => {
        writeRouteFile('routes/api/users/index.mjs', `
            export default function handler(req, res) {
                res.json({ path: '/api/users' });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/api/users');
        assert.equal(res.status, 200);
        assert.equal(res.body.path, '/api/users');
    });

    it('mounts dynamic segment routes', async () => {
        writeRouteFile('routes/users/[id].mjs', `
            export default function handler(req, res) {
                res.json({ userId: req.params.id });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/users/42');
        assert.equal(res.status, 200);
        assert.equal(res.body.userId, '42');
    });

    it('.routes/ takes priority over routes/', async () => {
        // Both define the same route path: /items
        writeRouteFile('routes/items.mjs', `
            export default function handler(req, res) {
                res.json({ source: 'routes' });
            }
        `);
        writeRouteFile('.routes/items.mjs', `
            export default function handler(req, res) {
                res.json({ source: 'dotRoutes' });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/items');
        assert.equal(res.status, 200);
        assert.equal(res.body.source, 'dotRoutes');
    });

    it('route groups are stripped from URL path', async () => {
        writeRouteFile('routes/(admin)/dashboard.mjs', `
            export default function handler(req, res) {
                res.json({ page: 'dashboard' });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/dashboard');
        assert.equal(res.status, 200);
        assert.equal(res.body.page, 'dashboard');
    });

    it('api/ directory keeps api in the URL path', async () => {
        writeRouteFile('api/health.mjs', `
            export default function handler(req, res) {
                res.json({ status: 'ok' });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/api/health');
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
    });

    it('handles errors in route handlers gracefully', async () => {
        writeRouteFile('routes/broken.mjs', `
            export default function handler(req, res) {
                throw new Error('Intentional test error');
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/broken');
        assert.equal(res.status, 500);
        assert.equal(res.body.error, 'Intentional test error');
    });

    it('skips files with no valid exports', async () => {
        writeRouteFile('routes/no-export.mjs', `
            // This file has no route export
            const x = 42;
        `);

        const app = createApp();
        // Should not throw
        await mountDynamicRoutes(app, tmpDir);
    });

    it('skips files starting with underscore', async () => {
        writeRouteFile('routes/_middleware.mjs', `
            export default function handler(req, res) {
                res.json({ private: true });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/_middleware');
        assert.equal(res.status, 404);
    });

    it('disabled via env var', async () => {
        writeRouteFile('routes/items.mjs', `
            export default function handler(req, res) {
                res.json({ ok: true });
            }
        `);

        const origEnv = process.env.OBOTO_DYNAMIC_ROUTES;
        process.env.OBOTO_DYNAMIC_ROUTES = 'false';

        try {
            const app = createApp();
            await mountDynamicRoutes(app, tmpDir);

            const res = await request(app).get('/items');
            assert.equal(res.status, 404);
        } finally {
            if (origEnv === undefined) {
                delete process.env.OBOTO_DYNAMIC_ROUTES;
            } else {
                process.env.OBOTO_DYNAMIC_ROUTES = origEnv;
            }
        }
    });

    it('disabled via .oboto.json config', async () => {
        writeRouteFile('routes/items.mjs', `
            export default function handler(req, res) {
                res.json({ ok: true });
            }
        `);
        fs.writeFileSync(
            path.join(tmpDir, '.oboto.json'),
            JSON.stringify({ dynamicRoutes: { enabled: false } }),
            'utf8'
        );

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const res = await request(app).get('/items');
        assert.equal(res.status, 404);
    });

    it('works when no route directories exist', async () => {
        const app = createApp();
        // Should not throw even with empty workspace
        await mountDynamicRoutes(app, tmpDir);
    });

    it('static routes match before dynamic routes', async () => {
        writeRouteFile('routes/users/settings.mjs', `
            export default function handler(req, res) {
                res.json({ type: 'static' });
            }
        `);
        writeRouteFile('routes/users/[id].mjs', `
            export default function handler(req, res) {
                res.json({ type: 'dynamic', id: req.params.id });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        // "settings" should match the static route, not [id]
        const staticRes = await request(app).get('/users/settings');
        assert.equal(staticRes.status, 200);
        assert.equal(staticRes.body.type, 'static');

        // "42" should match the dynamic route
        const dynamicRes = await request(app).get('/users/42');
        assert.equal(dynamicRes.status, 200);
        assert.equal(dynamicRes.body.type, 'dynamic');
        assert.equal(dynamicRes.body.id, '42');
    });

    it('multiple routes in the same directory', async () => {
        writeRouteFile('routes/api/products.mjs', `
            export default function handler(req, res) {
                res.json({ endpoint: 'products' });
            }
        `);
        writeRouteFile('routes/api/orders.mjs', `
            export default function handler(req, res) {
                res.json({ endpoint: 'orders' });
            }
        `);

        const app = createApp();
        await mountDynamicRoutes(app, tmpDir);

        const productsRes = await request(app).get('/api/products');
        assert.equal(productsRes.status, 200);
        assert.equal(productsRes.body.endpoint, 'products');

        const ordersRes = await request(app).get('/api/orders');
        assert.equal(ordersRes.status, 200);
        assert.equal(ordersRes.body.endpoint, 'orders');
    });
});
