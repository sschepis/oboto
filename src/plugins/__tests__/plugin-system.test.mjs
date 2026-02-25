import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('fs/promises', () => ({
    default: {
        mkdir: jest.fn().mockResolvedValue(),
        readFile: jest.fn(),
        writeFile: jest.fn().mockResolvedValue(),
        rm: jest.fn().mockResolvedValue(),
        readdir: jest.fn(),
        access: jest.fn().mockResolvedValue(),
    }
}));

jest.unstable_mockModule('node:child_process', () => ({
    execFile: jest.fn((cmd, args, options, cb) => {
        if (typeof cb === 'function') {
            cb(null, 'mock stdout', '');
        } else if (typeof options === 'function') {
            options(null, 'mock stdout', '');
        }
    })
}));

const fs = (await import('fs/promises')).default;
const { execFile } = await import('node:child_process');

const { PluginStorage } = await import('../plugin-storage.mjs');
const { PluginSettingsStore } = await import('../plugin-settings.mjs');
const { createPluginAPI } = await import('../plugin-api.mjs');
const { PluginInstaller } = await import('../plugin-installer.mjs');


// We use a mock ToolExecutor pattern as instructed
function createMinimalToolExecutor() {
    return {
        _pluginHandlers: new Map(),
        _pluginSchemas: new Map(),
        _pluginSurfaceSafe: new Set(),
        registerPluginTool: function(name, handler, schema, options = {}) {
            if (this._pluginHandlers.has(name)) {
                console.warn(`[ToolExecutor] Plugin tool name collision: "${name}" — overwriting`);
            }
            this._pluginHandlers.set(name, handler);
            this._pluginSchemas.set(name, schema);
            if (options.surfaceSafe) {
                this._pluginSurfaceSafe.add(name);
            }
        },
        unregisterPluginTool: function(name) {
            this._pluginHandlers.delete(name);
            this._pluginSurfaceSafe.delete(name);
            this._pluginSchemas.delete(name);
        },
    };
}


describe('Plugin System', () => {

    describe('PluginStorage', () => {
        let storage;

        beforeEach(() => {
            jest.clearAllMocks();
            // Use a mock timer to handle the debounced flush
            jest.useFakeTimers();
            storage = new PluginStorage('test-plugin', '/test/workspace');
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should get and set values', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT')); // File doesn't exist yet

            await storage.set('key1', 'value1');
            expect(await storage.get('key1')).toBe('value1');

            // Should have scheduled a write
            jest.runAllTimers();
            // In the real impl, flush is awaited, but in fake timers it's queued.
            // Let's await the actual flush call.
            await Promise.resolve(); // allow microtasks
            
            expect(fs.writeFile).toHaveBeenCalled();
            const writeCall = fs.writeFile.mock.calls[0];
            expect(writeCall[0]).toContain('storage.json');
            expect(JSON.parse(writeCall[1])).toEqual({ key1: 'value1' });
        });

        it('should perform CRUD operations correctly', async () => {
            fs.readFile.mockResolvedValueOnce(JSON.stringify({ existing: 'data' }));

            expect(await storage.has('existing')).toBe(true);
            expect(await storage.get('existing')).toBe('data');

            const keys = await storage.keys();
            expect(keys).toContain('existing');

            const deleted = await storage.delete('existing');
            expect(deleted).toBe(true);
            expect(await storage.has('existing')).toBe(false);
        });

        it('should force pending writes on flush', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

            await storage.set('key', 'value');
            // Write is scheduled (debounced)
            expect(fs.writeFile).not.toHaveBeenCalled();

            await storage.flush();
            
            expect(fs.writeFile).toHaveBeenCalled();
            const writeCall = fs.writeFile.mock.calls[0];
            expect(JSON.parse(writeCall[1])).toEqual({ key: 'value' });
        });
    });

    describe('PluginSettingsStore', () => {
        let settings;

        beforeEach(() => {
            jest.clearAllMocks();
            settings = new PluginSettingsStore('test-plugin', '/test/workspace');
        });

        it('should return default value when key is missing', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
            const val = await settings.get('missingKey', 'defaultVal');
            expect(val).toBe('defaultVal');
        });

        it('should read and write values', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
            
            await settings.set('theme', 'dark');
            expect(fs.writeFile).toHaveBeenCalled();
            const writeCall = fs.writeFile.mock.calls[0];
            expect(JSON.parse(writeCall[1])).toEqual({ theme: 'dark' });

            const all = await settings.getAll();
            expect(all).toEqual({ theme: 'dark' });
            
            await settings.setAll({ size: 'large' });
            const allUpdated = await settings.getAll();
            expect(allUpdated).toEqual({ theme: 'dark', size: 'large' });
        });

        it('should delete keys and reset', async () => {
            fs.readFile.mockResolvedValueOnce(JSON.stringify({ k1: 'v1', k2: 'v2' }));

            const deleted = await settings.delete('k1');
            expect(deleted).toBe(true);
            expect(await settings.get('k1')).toBeUndefined();
            expect(await settings.get('k2')).toBe('v2');

            await settings.reset();
            expect(await settings.getAll()).toEqual({});
        });

        it('should throw when setting sensitive keys', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

            await expect(settings.set('apiKey', 'sk-secret-123'))
                .rejects.toThrow(/Cannot store.*apiKey.*plaintext/i);
            await expect(settings.set('db_password', 'hunter2'))
                .rejects.toThrow(/Cannot store.*password.*plaintext/i);
            await expect(settings.set('auth_token', 'tok-abc'))
                .rejects.toThrow(/Cannot store.*token.*plaintext/i);
            await expect(settings.set('aws_secret', 'AKIA...'))
                .rejects.toThrow(/Cannot store.*secret.*plaintext/i);
            
            // Non-sensitive keys should still work
            await settings.set('theme', 'dark');
            expect(await settings.get('theme')).toBe('dark');
        });

        it('should throw in setAll when any key is sensitive', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
            
            await expect(settings.setAll({ safeKey: 'ok', api_key: 'secret' }))
                .rejects.toThrow(/Cannot store.*api_key.*plaintext/i);
        });

        it('should fall through to process.env for sensitive keys', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
            
            // Set up env var
            const originalEnv = process.env.SERPER_API_KEY;
            process.env.SERPER_API_KEY = 'test-key-from-env';
            
            try {
                const val = await settings.get('serperApiKey');
                expect(val).toBe('test-key-from-env');
            } finally {
                if (originalEnv !== undefined) {
                    process.env.SERPER_API_KEY = originalEnv;
                } else {
                    delete process.env.SERPER_API_KEY;
                }
            }
        });

        it('should return defaultValue for non-sensitive missing keys (no env fallthrough)', async () => {
            fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
            
            const val = await settings.get('theme', 'light');
            expect(val).toBe('light');
        });
    });

    describe('ToolExecutor Plugin Methods', () => {
        let toolExecutor;

        beforeEach(() => {
            toolExecutor = createMinimalToolExecutor();
        });

        it('should register and unregister a plugin tool', () => {
            const handler = () => {};
            const schema = { type: 'function', function: { name: 'test_tool' } };

            toolExecutor.registerPluginTool('test_tool', handler, schema, { surfaceSafe: true });

            expect(toolExecutor._pluginHandlers.get('test_tool')).toBe(handler);
            expect([...toolExecutor._pluginSchemas.values()]).toContainEqual(schema);
            expect(toolExecutor._pluginSurfaceSafe.has('test_tool')).toBe(true);

            toolExecutor.unregisterPluginTool('test_tool');

            expect(toolExecutor._pluginHandlers.has('test_tool')).toBe(false);
            expect(toolExecutor._pluginSchemas.size).toBe(0);
            expect(toolExecutor._pluginSurfaceSafe.has('test_tool')).toBe(false);
        });

        it('should replace schema on re-registration (Fix #1)', () => {
            const handler1 = () => {};
            const schema1 = { type: 'function', function: { name: 'tool_a', description: 'v1' } };
            
            const handler2 = () => {};
            const schema2 = { type: 'function', function: { name: 'tool_a', description: 'v2' } };

            toolExecutor.registerPluginTool('tool_a', handler1, schema1);
            expect(toolExecutor._pluginSchemas.size).toBe(1);
            expect(toolExecutor._pluginSchemas.get('tool_a').function.description).toBe('v1');

            toolExecutor.registerPluginTool('tool_a', handler2, schema2);
            // Should still be 1 after replacing
            expect(toolExecutor._pluginSchemas.size).toBe(1);
            expect(toolExecutor._pluginSchemas.get('tool_a').function.description).toBe('v2');
        });
    });

    describe('PluginAPI', () => {
        let mockToolExecutor;
        let mockWsDispatcher;
        let mockEventBus;
        let deps;
        let api;

        beforeEach(() => {
            mockToolExecutor = {
                registerPluginTool: jest.fn(),
                unregisterPluginTool: jest.fn(),
                getToolFunction: jest.fn(),
                executeTool: jest.fn(),
            };
            mockWsDispatcher = { register: jest.fn(), unregister: jest.fn() };
            mockEventBus = { on: jest.fn(), off: jest.fn(), emit: jest.fn(), once: jest.fn() };

            deps = {
                toolExecutor: mockToolExecutor,
                wsDispatcher: mockWsDispatcher,
                eventBus: mockEventBus,
                workingDir: '/workspace'
            };

            api = createPluginAPI('my-plugin', deps);
        });

        it('should register tools with prefixing by default', () => {
            const handler = jest.fn();
            const fullName = api.tools.register({
                name: 'do_thing',
                description: 'Does a thing',
                handler
            });

            expect(fullName).toBe('plugin_my-plugin_do_thing');
            expect(mockToolExecutor.registerPluginTool).toHaveBeenCalledWith(
                'plugin_my-plugin_do_thing',
                handler,
                expect.objectContaining({
                    type: 'function',
                    function: expect.objectContaining({ name: 'plugin_my-plugin_do_thing' })
                }),
                expect.objectContaining({ surfaceSafe: false })
            );
        });

        it('should NOT allow useOriginalName for non-builtin plugins', () => {
            const handler = jest.fn();
            const fullName = api.tools.register({
                name: 'global_thing',
                description: 'Does a global thing',
                handler,
                useOriginalName: true
            });

            // Non-builtin plugins get prefixed even with useOriginalName
            expect(fullName).toBe('plugin_my-plugin_global_thing');
            expect(mockToolExecutor.registerPluginTool).toHaveBeenCalledWith(
                'plugin_my-plugin_global_thing',
                handler,
                expect.objectContaining({
                    type: 'function',
                    function: expect.objectContaining({ name: 'plugin_my-plugin_global_thing' })
                }),
                expect.objectContaining({ surfaceSafe: false })
            );
        });

        it('should allow useOriginalName for builtin plugins', () => {
            const builtinApi = createPluginAPI('my-plugin', deps, { source: 'builtin' });
            const handler = jest.fn();
            const fullName = builtinApi.tools.register({
                name: 'global_thing',
                description: 'Does a global thing',
                handler,
                useOriginalName: true
            });

            expect(fullName).toBe('global_thing');
            expect(mockToolExecutor.registerPluginTool).toHaveBeenCalledWith(
                'global_thing',
                handler,
                expect.objectContaining({
                    type: 'function',
                    function: expect.objectContaining({ name: 'global_thing' })
                }),
                expect.objectContaining({ surfaceSafe: false })
            );
        });

        it('should unregister tools', () => {
            api.tools.register({ name: 'my_tool', handler: jest.fn() });
            api.tools.unregister('my_tool'); // can use original short name

            expect(mockToolExecutor.unregisterPluginTool).toHaveBeenCalledWith('plugin_my-plugin_my_tool');
        });

        it('should clean up resources on _cleanup()', async () => {
            api.tools.register({ name: 't1', handler: jest.fn() });
            api.ws.register('w1', jest.fn());
            api.events.on('e1', jest.fn());

            await api._cleanup();

            expect(mockToolExecutor.unregisterPluginTool).toHaveBeenCalled();
            expect(mockWsDispatcher.unregister).toHaveBeenCalled();
            expect(mockEventBus.off).toHaveBeenCalled();
        });

        it('should expose services for builtin plugins', () => {
            const builtinApi = createPluginAPI('svc-test', {
                ...deps,
                pluginManager: { _deps: { assistant: { name: 'test-assistant' }, secretsManager: { name: 'sm' } } }
            }, { source: 'builtin' });

            expect(builtinApi.services).toBeDefined();
            expect(builtinApi.services.assistant).toEqual({ name: 'test-assistant' });
            expect(builtinApi.services.secretsManager).toEqual({ name: 'sm' });
            expect(builtinApi.services.workingDir).toBe('/workspace');
        });

        it('should NOT expose services for non-builtin plugins', () => {
            const nonBuiltinApi = createPluginAPI('svc-test', deps, { source: 'workspace' });
            expect(nonBuiltinApi.services).toBeUndefined();
        });

        it('should block non-builtin plugins from executing restricted tools', async () => {
            // Create a non-builtin (workspace) plugin API
            const workspaceApi = createPluginAPI('untrusted-plugin', deps, { source: 'workspace' });
            
            // Mock executeTool so we can detect if it's called
            mockToolExecutor.executeTool = jest.fn().mockResolvedValue({ content: 'ok' });
            
            // Should throw for restricted tools
            await expect(workspaceApi.tools.execute('run_command', { command: 'rm -rf /' }))
                .rejects.toThrow(/not authorized to execute restricted tool/);
            await expect(workspaceApi.tools.execute('execute_javascript', { code: 'process.exit()' }))
                .rejects.toThrow(/not authorized to execute restricted tool/);
            await expect(workspaceApi.tools.execute('spawn_background_task', {}))
                .rejects.toThrow(/not authorized to execute restricted tool/);
            
            // executeTool should NOT have been called
            expect(mockToolExecutor.executeTool).not.toHaveBeenCalled();
        });

        it('should allow builtin plugins to execute restricted tools', async () => {
            const builtinApi = createPluginAPI('trusted-plugin', deps, { source: 'builtin' });
            
            mockToolExecutor.executeTool = jest.fn().mockResolvedValue({ content: 'executed' });
            
            // Should NOT throw for builtin plugins
            const result = await builtinApi.tools.execute('run_command', { command: 'ls' });
            expect(result).toBe('executed');
            expect(mockToolExecutor.executeTool).toHaveBeenCalledTimes(1);
        });

        it('should allow non-builtin plugins to execute unrestricted tools', async () => {
            const workspaceApi = createPluginAPI('safe-plugin', deps, { source: 'workspace' });
            
            mockToolExecutor.executeTool = jest.fn().mockResolvedValue({ content: 'file contents' });
            
            // read_file is not restricted
            const result = await workspaceApi.tools.execute('read_file', { path: 'test.txt' });
            expect(result).toBe('file contents');
            expect(mockToolExecutor.executeTool).toHaveBeenCalledTimes(1);
        });
    });

    describe('PluginInstaller Input Validation', () => {
        let installer;

        beforeEach(() => {
            installer = new PluginInstaller({ workingDir: '/workspace' });
        });

        it('should throw on empty spec', async () => {
            await expect(installer.install('')).rejects.toThrow('Plugin spec must be a non-empty string');
        });

        it('should throw on overly long spec', async () => {
            const longSpec = 'a'.repeat(501);
            await expect(installer.install(longSpec)).rejects.toThrow('Plugin spec is too long');
        });

        it('should throw on shell metacharacters', async () => {
            await expect(installer.install('pkg;rm -rf /')).rejects.toThrow('Plugin spec contains invalid characters');
            await expect(installer.install('pkg&foo')).rejects.toThrow('Plugin spec contains invalid characters');
            await expect(installer.install('pkg|foo')).rejects.toThrow('Plugin spec contains invalid characters');
            await expect(installer.install('pkg`foo`')).rejects.toThrow('Plugin spec contains invalid characters');
        });

        it('should pass validation for valid spec', async () => {
            // We expect it to eventually fail because our mocked execFile callback isn't configured
            // perfectly to simulate the whole pnpm install process with file reads,
            // but we want to ensure it DOES NOT throw the validation errors above.
            fs.mkdir.mockResolvedValueOnce();
            // Since we mocked execFile to just return without error, it will try to read package.json
            // and might fail there. We're just checking the initial validation passes.
            try {
                await installer.install('valid-plugin');
            } catch (e) {
                expect(e.message).not.toMatch(/Plugin spec/);
            }
        });

        it('should reject path-traversal names in uninstall()', async () => {
            await expect(installer.uninstall('../../etc')).rejects.toThrow(/path-traversal/);
            await expect(installer.uninstall('foo/bar')).rejects.toThrow(/path-traversal/);
            await expect(installer.uninstall('foo\\bar')).rejects.toThrow(/path-traversal/);
            await expect(installer.uninstall('..')).rejects.toThrow(/path-traversal/);
        });

        it('should reject path-traversal names in update()', async () => {
            await expect(installer.update('../../etc')).rejects.toThrow(/path-traversal/);
            await expect(installer.update('foo/bar')).rejects.toThrow(/path-traversal/);
        });

        it('should accept valid plugin names in uninstall()', async () => {
            // uninstall will try to access directories but shouldn't throw a name validation error
            fs.access.mockRejectedValue(new Error('ENOENT')); // directory doesn't exist
            const result = await installer.uninstall('valid-plugin-name');
            expect(result).toBe(true);
        });
    });

});
