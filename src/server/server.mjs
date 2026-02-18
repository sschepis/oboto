import express from 'express';
import { AiMan } from '../lib/index.mjs';
import bodyParser from 'body-parser';

export function createServer(config = {}) {
    const app = express();
    app.use(bodyParser.json({ limit: '10mb' }));
    
    // Session store: one AiMan per session
    const sessions = new Map();
    
    function getSession(sessionId) {
        if (!sessionId) sessionId = 'default';
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, new AiMan(config));
        }
        return sessions.get(sessionId);
    }
    
    // Basic execute
    app.post('/api/execute', async (req, res) => {
        const { task, sessionId = 'default', options = {} } = req.body;
        const ai = getSession(sessionId);
        try {
            const result = await ai.execute(task, options);
            res.json({ result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // Stream execute (SSE)
    app.post('/api/execute/stream', async (req, res) => {
        const { task, sessionId = 'default', options = {} } = req.body;
        const ai = getSession(sessionId);
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        try {
            await ai.executeStream(task, (chunk) => {
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }, options);
            res.write('data: [DONE]\n\n');
            res.end();
        } catch (error) {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    });
    
    // Design
    app.post('/api/design', async (req, res) => {
        const { task, sessionId, options } = req.body;
        const ai = getSession(sessionId);
        try {
            const result = await ai.design(task, options);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Implement
    app.post('/api/implement', async (req, res) => {
        const { designResult, sessionId, options } = req.body;
        const ai = getSession(sessionId);
        try {
            // Rehydrate DesignResult
            // (Assuming simple object passing, but might need class rehydration)
            const result = await ai.implement(designResult, options);
            res.json({ result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    return app;
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const port = process.env.PORT || 3000;
    const app = createServer();
    app.listen(port, () => {
        console.log(`Robodev server running on http://localhost:${port}`);
    });
}
