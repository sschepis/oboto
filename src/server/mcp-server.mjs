import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AiMan } from '../lib/index.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

const server = new Server({
    name: 'oboto',
    version: '1.0.0',
}, {
    capabilities: { tools: {} }
});

const aiMan = new AiMan();

server.setRequestHandler('tools/list', async () => ({
    tools: [
        {
            name: 'execute_dev_task',
            description: 'Execute a software development task using the AI-powered oboto system.',
            inputSchema: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'The development task to execute' },
                    workingDir: { type: 'string', description: 'Working directory (optional)' }
                },
                required: ['task']
            }
        },
        {
            name: 'design_task',
            description: 'Create a technical design document for a development task.',
            inputSchema: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'What to design' }
                },
                required: ['task']
            }
        }
    ]
}));

server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    
    switch (name) {
        case 'execute_dev_task': {
            const result = await aiMan.execute(args.task);
            return { content: [{ type: 'text', text: result }] };
        }
        case 'design_task': {
            const design = await aiMan.design(args.task);
            return { content: [{ type: 'text', text: design.document }] };
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => consoleStyler.logError('system', 'MCP server failed to start', err));
}
