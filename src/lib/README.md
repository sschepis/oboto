# AI Man Library Interface

This module exposes the core AI Assistant capabilities as a structured library, allowing integration into other AI agents, tools, or applications.

## Overview

The `AiMan` class provides a high-level interface to the AI system. It supports:
- **Dependency Injection**: Plug in your own LLM provider and status reporting mechanisms.
- **Agent Integration**: Easily expose the system as a tool for other AI agents (e.g., LangChain, AutoGPT).
- **Callback Statusing**: Receive real-time updates on progress, tool execution, and logs.

## Usage

### Basic Usage

```javascript
import { AiMan } from 'ai-assistant/lib';

// Initialize with default settings (uses internal LLM and console output)
const ai = new AiMan();

// Execute a complex task
const result = await ai.execute("Create a new feature for user authentication in the current project");

console.log(result);
```

### Advanced Usage with Custom Adapters

You can inject custom adapters to control how the AI communicates and reports status.

```javascript
import { AiMan } from 'ai-assistant/lib';

// Custom LLM Adapter (must implement generateContent)
const myLLMAdapter = {
    async generateContent(request) {
        // request follows OpenAI Chat Completion API format
        // Call your own model service here...
        return {
            choices: [{
                message: { role: 'assistant', content: '...' }
            }]
        };
    }
};

// Custom Status Adapter (must implement log, onProgress, etc.)
const myStatusAdapter = {
    log(level, message, meta) {
        // Send logs to your dashboard/frontend
        socket.emit('log', { level, message, meta });
    },
    onProgress(percent, status) {
        updateProgressBar(percent, status);
    },
    onToolStart(name, args) {
        console.log(`Tool Started: ${name}`);
    },
    onToolEnd(name, result) {
        console.log(`Tool Ended: ${name}`);
    }
};

// Initialize with adapters
const ai = new AiMan({
    workingDir: '/path/to/project',
    llmAdapter: myLLMAdapter,
    statusAdapter: myStatusAdapter
});

await ai.execute("Refactor the login module");
```

## Agent Integration

To use AI Man as a tool within another agent (e.g., a "Manager" agent delegating coding tasks), use `getToolDefinition()`:

```javascript
const aiMan = new AiMan();
const toolDef = aiMan.getToolDefinition();

// toolDef matches standard JSON Schema for function calling:
// {
//   "name": "execute_software_development_task",
//   "description": "...",
//   "parameters": { ... }
// }

// Register this tool with your primary agent
myAgent.registerTool(toolDef, async (args) => {
    return await aiMan.execute(args.task);
});
```

## API Reference

### `AiMan` Class

#### `constructor(config)`
- `config.workingDir`: Path to the project root (default: `process.cwd()`).
- `config.llmAdapter`: Object implementing `LLMAdapter` interface.
- `config.statusAdapter`: Object implementing `StatusAdapter` interface.
- `config.overrides`: Optional configuration overrides (model, etc.).

#### `async execute(task)`
Executes the given natural language task. Returns a Promise resolving to the final output string.

#### `getToolDefinition()`
Returns a JSON Schema object describing the `execute` capability, suitable for LLM function calling.

### Interfaces

See `src/lib/interfaces.d.ts` for TypeScript definitions of `LLMAdapter` and `StatusAdapter`.
