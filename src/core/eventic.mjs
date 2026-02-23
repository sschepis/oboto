/**
 * Eventic Core Engine
 * 
 * Provides an event-driven agent loop with pluggable backends and tools.
 */

// --- Base Interface Definitions (Conceptual) ---
// AI Provider: { ask(prompt, options), clearHistory() }
// Tool: Function (async)

export class Eventic {
    constructor(options = {}) {
        this.context = {
            goal: "",
            mode: "interactive",
            status: "idle",
            currentAction: '',
            plan: [],
            currentStepIndex: 0,
            results: [],
            memory: {},
            files: {},
            metrics: {
                totalSteps: 0,
                completedSteps: 0,
                score: 100,
                history: []
            },
            ...options.context
        };

        this.ai = options.ai || null;
        this.tools = new Map(Object.entries(options.tools || {}));
        this.handlers = new Map();
        
        // Setup logger (defaults to no-op if disabled, or console.log)
        this.logHandlers = options.logHandlers || [console.log];
    }

    log(message) {
        for (const handler of this.logHandlers) {
            if (typeof handler === 'function') {
                handler(message);
            }
        }
    }

    use(plugin) {
        if (plugin.type === 'ai') {
            this.ai = plugin.provider || plugin;
        } else if (plugin.type === 'tool') {
            this.registerTool(plugin.name, plugin.execute);
        } else if (typeof plugin.install === 'function') {
            plugin.install(this);
        }
        return this;
    }

    registerTool(name, fn) {
        this.tools.set(name, fn);
        return this;
    }

    registerHandler(name, fn) {
        this.handlers.set(name, fn);
        return this;
    }

    async dispatch(name, payload = {}) {
        const handler = this.handlers.get(name);
        if (!handler) {
            throw new Error(`[ERROR] Missing handler: ${name}`);
        }
        
        const eventLog = (message) => this.log(`[${name}] ${message}`);
        
        try {
            return await handler(this.context, payload, eventLog, this.dispatch.bind(this), this);
        } catch (error) {
            // Parse structured JSON error messages for readable logging
            let displayMessage = error.message;
            if (displayMessage && displayMessage.startsWith('{')) {
                try {
                    const parsed = JSON.parse(displayMessage);
                    displayMessage = parsed?.error?.message || parsed?.message || displayMessage;
                } catch { /* use raw message */ }
            }
            this.log(`[${name}] Error: ${displayMessage}`);
            this.context.status = "error";
            throw error;
        }
    }
}

// --- Schemas ---
export const defaultSchemas = {
    classification: {
        type: 'object',
        properties: {
            simple: { type: 'boolean' },
            response: { type: 'string' }
        },
        required: ['simple']
    },
    taskList: {
        type: 'array',
        items: { type: 'string' }
    },
    review: {
        type: 'object',
        properties: {
            valid: { type: 'boolean' },
            feedback: { type: 'string' }
        },
        required: ['valid']
    },
    critique: {
        type: 'object',
        properties: {
            pass: { type: 'boolean' },
            suggestions: { type: 'string' }
        },
        required: ['pass']
    },
    lessons: {
        type: 'array',
        items: { type: 'string' }
    }
};

// --- Default Tool Plugins ---
export const defaultTools = {
    install(eventic) {
        eventic.registerTool('web_search', async (query) => {
            eventic.log(`🌐 Web Search: ${query}`);
            return `Web results for: ${query}`;
        });
        
        eventic.registerTool('database_save', async (key, value) => {
            eventic.context.memory[key] = value;
            eventic.log(`💾 Saved: ${key}`);
            return { success: true };
        });
        
        eventic.registerTool('database_get', async (key) => eventic.context.memory[key] || null);
        
        eventic.registerTool('database_query', async (query) => {
            return Object.entries(eventic.context.memory)
                .filter(([k]) => k.toLowerCase().includes(query.toLowerCase()))
                .map(([k, v]) => ({ key: k, value: v }));
        });
        
        eventic.registerTool('database_save_memory', async ({ lessons, goal }) => {
            const key = `lesson_${Date.now()}`;
            eventic.context.memory[key] = { lessons, goal, timestamp: new Date().toISOString() };
            return { success: true };
        });
        
        eventic.registerTool('bash', async (command) => {
            eventic.log(`💻 Bash: ${command}`);
            return `[Simulated] Output of: ${command}`;
        });
        
        eventic.registerTool('file_read', async (path) => {
            eventic.log(`📂 Read: ${path}`);
            const normalizedPath = path.startsWith('/') ? path : `/${path}`;
            if (eventic.context.files[normalizedPath]) {
                return eventic.context.files[normalizedPath].content;
            }
            return `[Error] File not found: ${path}`;
        });
        
        eventic.registerTool('file_write', async (path, content) => {
            const normalizedPath = path.startsWith('/') ? path : `/${path}`;
            eventic.context.files[normalizedPath] = {
                content,
                created: new Date().toISOString(),
                modified: new Date().toISOString()
            };
            eventic.log(`📝 Write: ${path} (${content.length} chars)`);
            return `Written to: ${path}`;
        });
        
        eventic.registerTool('file_list', async (directory = '/') => {
            eventic.log(`📁 List: ${directory}`);
            const normalizedDir = directory.startsWith('/') ? directory : `/${directory}`;
            const files = Object.keys(eventic.context.files)
                .filter(p => {
                    if (normalizedDir === '/') return true;
                    return p.startsWith(normalizedDir);
                })
                .map(p => {
                    const relativePath = normalizedDir === '/' ? p : p.replace(normalizedDir, '');
                    return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
                });
            return files.length > 0 ? files : ['(no files)'];
        });
        
        eventic.registerTool('file_exists', async (path) => {
            const normalizedPath = path.startsWith('/') ? path : `/${path}`;
            return !!eventic.context.files[normalizedPath];
        });
        
        eventic.registerTool('file_delete', async (path) => {
            const normalizedPath = path.startsWith('/') ? path : `/${path}`;
            if (eventic.context.files[normalizedPath]) {
                delete eventic.context.files[normalizedPath];
                eventic.log(`🗑️ Delete: ${path}`);
                return `Deleted: ${path}`;
            }
            return `[Error] File not found: ${path}`;
        });
    }
};

