# LMScript Agent Loop Provider

## Overview

The LMScript Agent Loop is a CLI-style autonomous agent provider that processes user input through a structured command interface with piping, dual holographic memory systems, and dynamic tool creation. It is registered as the `lmscript` agentic provider in the ai-man system.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  LMScriptProvider                    │
│                  (Agent Loop Core)                   │
│                                                     │
│  ┌───────────────┐  ┌────────────────────────────┐  │
│  │   Persona      │  │   OODA Agent Loop          │  │
│  │   (Static      │  │                            │  │
│  │    Context)     │  │  Observe → Orient →        │  │
│  │                 │  │  Decide → Act              │  │
│  └───────────────┘  └────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │         Dual Holographic Memory                │  │
│  │                                                │  │
│  │  ┌──────────────┐  ┌────────────────────────┐  │  │
│  │  │  Associative  │  │   On-Demand            │  │  │
│  │  │  (Passive)    │  │   (Active)             │  │  │
│  │  │              │  │                        │  │  │
│  │  │  Auto-inject  │  │  COMMAND RECALL <q>    │  │  │
│  │  │  before turn  │  │  COMMAND REMEMBER <t>  │  │  │
│  │  │  Auto-extract │  │                        │  │  │
│  │  │  after turn   │  │  Explicit agent        │  │  │
│  │  │              │  │  decision              │  │  │
│  │  └──────────────┘  └────────────────────────┘  │  │
│  │                                                │  │
│  │  Backed by: ResoLangService + CognitiveCore    │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              CLI Executor                      │  │
│  │                                                │  │
│  │  COMMAND <name> <params>                       │  │
│  │  Pipe: CMD_A | CMD_B | CMD_C                   │  │
│  │                                                │  │
│  │  Built-ins: RECALL, REMEMBER, CREATE, ECHO,    │  │
│  │             HTTP_GET, TOOLS, TOOL, NOOP        │  │
│  │                                                │  │
│  │  Dynamic: Tools created via COMMAND CREATE      │  │
│  │  AI-Man: Full tool ecosystem via COMMAND TOOL   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Activation

### Via Configuration
```json
{
  "ai": {
    "agenticProvider": "lmscript"
  }
}
```

### Via Runtime API
```javascript
await facade.switchAgenticProvider('lmscript');
```

### Via WebSocket
```json
{ "type": "update-settings", "settings": { "agenticProvider": "lmscript" } }
```

## Memory Systems

### 1. Associative Memory (Passive / Auto-Injected)

Associative memory operates outside the agent's direct control. It is handled automatically by the provider's middleware layer:

**Input Decoration**: Before the agent's Act phase runs, a keyword/holographic search retrieves context relevant to the current observation. This is silently prepended to the prompt as `[Subconscious Associative Memories]`.

**Output Extraction**: The agent's structured JSON response includes a `memories_to_store` array. The provider automatically extracts these and stores them in the holographic field for future recall.

**Backing Stores**:
- **ResoLangService** — Workspace-level holographic memory using WASM-based prime-resonant encoding. Memories are persisted to `{workingDir}/.memory.json` and globally to `~/.oboto/global-memory.json`.
- **CognitiveCore** (tinyaleph) — In-process prime-resonant memory with SedenionMemoryField (16-axis semantic orientation), PRSC oscillator physics, and HolographicEncoder.

### 2. On-Demand Memory (Active / Explicit)

On-demand memory is controlled directly by the agent through CLI commands:

```
COMMAND RECALL "project constraints"
COMMAND REMEMBER "The user prefers dark mode"
```

The agent explicitly decides when to search or store. This maps to the same backing stores but through deliberate agent action rather than automatic middleware.

## CLI Command Interface

### Syntax
```
COMMAND <name> <params> [| COMMAND <name> <params>]
```

### Built-in Commands

| Command | Description | Example |
|---------|-------------|---------|
| `RECALL <query>` | Search holographic long-term memory | `COMMAND RECALL project architecture` |
| `REMEMBER <text>` | Store text in long-term memory | `COMMAND REMEMBER User prefers TypeScript` |
| `CREATE <name> <fn>` | Create a new dynamic tool | `COMMAND CREATE UPPERCASE function(ctx, p) { return p.toUpperCase(); }` |
| `ECHO <text>` | Output text (used for final responses) | `COMMAND ECHO Here is your answer...` |
| `HTTP_GET <url>` | Fetch a URL | `COMMAND HTTP_GET https://api.example.com/data` |
| `TOOLS` | List all available commands and tools | `COMMAND TOOLS` |
| `TOOL <name> <args>` | Execute any ai-man tool | `COMMAND TOOL read_file {"path": "src/main.mjs"}` |
| `NOOP` | No operation (respond with monologue) | `COMMAND NOOP` |

### Piping

Commands can be chained with the pipe operator `|`:

```
COMMAND HTTP_GET https://example.com | COMMAND ECHO
COMMAND RECALL user preferences | COMMAND ECHO
```

When piped, the output of each command becomes available as `pipeData` to the next command.

### Dynamic Tool Creation

The agent can create new tools at runtime using the `CREATE` command:

```
COMMAND CREATE WORD_COUNT function(context, params) {
  return String(params.split(' ').length);
}
```

Dynamic tools are:
- Executed in a sandboxed `node:vm` context (no access to `process`, `require`, `fs`, etc.)
- Persisted for the duration of the agent session
- Available in the command list for subsequent invocations
- Whitelisted to only `JSON`, `Math`, `Date`, `String`, `Number`, `Array`, `Object`, `Map`, `Set`, `RegExp`, and `fetch`

## Agent Loop Flow

Each invocation of `run(input)` executes the following loop:

```
┌─────────────────────────────────┐
│ 1. Save user input to history   │
│ 2. Process input (cognitive)     │
└──────────────┬──────────────────┘
               │
    ┌──────────▼──────────┐
    │  AGENT LOOP START    │◄──────────────────────┐
    └──────────┬──────────┘                        │
               │                                    │
    ┌──────────▼──────────┐                        │
    │  Fetch associative   │  ← Passive memory      │
    │  memory context      │    auto-injection       │
    └──────────┬──────────┘                        │
               │                                    │
    ┌──────────▼──────────┐                        │
    │  Tick physics        │  ← Advance oscillators  │
    └──────────┬──────────┘                        │
               │                                    │
    ┌──────────▼──────────┐                        │
    │  Call LLM for action │  ← Structured JSON      │
    │  (monologue +        │    response              │
    │   memories + command)│                        │
    └──────────┬──────────┘                        │
               │                                    │
    ┌──────────▼──────────┐                        │
    │  Store passive       │  ← Auto-extract         │
    │  memories            │    memories_to_store     │
    └──────────┬──────────┘                        │
               │                                    │
    ┌──────────▼──────────┐                        │
    │  Is ECHO/NOOP?       │──Yes──► Return response │
    └──────────┬──────────┘                        │
               │ No                                  │
    ┌──────────▼──────────┐                        │
    │  Execute CLI command │                        │
    │  (with pipe support) │                        │
    └──────────┬──────────┘                        │
               │                                    │
    ┌──────────▼──────────┐                        │
    │  Update observation  │                        │
    │  with command result │────────────────────────┘
    └─────────────────────┘
          (max 10 iterations)
```

## LLM Action Schema

The LLM is prompted to return a JSON object:

```json
{
  "internal_monologue": "My reasoning about the current situation...",
  "memories_to_store": ["Important fact 1", "Important fact 2"],
  "cli_command": "COMMAND RECALL project goals | COMMAND ECHO"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `internal_monologue` | string | The agent's reasoning process (visible in diagnostics) |
| `memories_to_store` | string[] | Facts to commit to associative memory automatically |
| `cli_command` | string | The CLI command to execute (with optional piping) |

## System Prompt Structure

The system prompt is constructed dynamically each turn:

1. **Persona** — Static context from the active persona configuration
2. **Available Commands** — Dynamically updated list including built-ins and created tools
3. **Command Documentation** — Description of special commands and piping syntax
4. **Response Schema** — JSON format requirements
5. **Cognitive State** — Current coherence, entropy, semantic axes, goals (from CognitiveCore)
6. **Iteration Counter** — Current session iteration count

## User Prompt Structure

The user prompt includes:

1. **[Subconscious Associative Memories]** — Auto-injected relevant context from holographic memory
2. **[Last Command Result]** — Output from the previous command execution
3. **[Recent Commands]** — Last 3 commands executed (breadcrumb trail)
4. **[Current Input/Observation]** — The current user input or command result

## Security Considerations

### Dynamic Tool Sandboxing
- Dynamic tools created via `COMMAND CREATE` execute in a `node:vm` sandbox
- No access to `process`, `require`, `import`, `fs`, `child_process`, or other Node.js APIs
- 10-second execution timeout
- Only whitelisted globals available (`JSON`, `Math`, `Date`, `fetch`, etc.)

### Pipe Break Handling
- When a command in a pipe chain fails, the error is captured and the chain is broken
- The error message is fed back into the agent's observation for self-debugging
- The agent can then adjust its command syntax on the next iteration

## Diagnostics

Access provider diagnostics via:

```javascript
const provider = facade.agenticRegistry.get('lmscript');
const diag = provider.getDiagnostics();
// {
//   iterationCount: 42,
//   commandHistory: ['COMMAND RECALL ...', 'COMMAND TOOL ...'],
//   dynamicTools: [{ name: 'UPPERCASE', createdAt: 1710612345 }],
//   memory: {
//     hasResoLang: true,
//     hasCognitiveCore: true,
//     cognitiveState: { coherence: 0.73, entropy: 1.2, ... },
//     resoLangState: { coherence: 0.8, entropy: 0.5, ... }
//   },
//   config: { maxIterations: 10, maxContinuations: 3, streamingEnabled: true }
// }
```

## File Structure

```
src/core/agentic/lmscript/
├── index.mjs                 # Barrel export
├── lmscript-provider.mjs     # LMScriptProvider (extends AgenticProvider)
├── holographic-memory.mjs    # HolographicMemoryAdapter (dual memory)
└── cli-executor.mjs          # CLIExecutor (command parsing + execution)
```

## Design Decisions

### Why a single CLI command interface?
Constraining the action space to a strict CLI format drastically reduces the cognitive load on the LLM. Instead of choosing from complex JSON tool payloads, the agent outputs a single command string. This is enforced by requiring JSON output with a `cli_command` field.

### Why dual memory?
Separating memory into "automatic/subconscious" (associative) and "manual/conscious" (on-demand) mirrors human cognitive architecture:
- **Associative**: Like how you unconsciously recall related experiences when encountering a situation
- **On-Demand**: Like deliberately trying to remember something specific

### Why holographic encoding?
Holographic memory distributes information across the entire field, providing graceful degradation and natural similarity-based retrieval. Combined with prime-resonant oscillator physics from tinyaleph, this creates a physically-grounded memory system rather than a simple key-value store.

### Why sandboxed dynamic tools?
The `COMMAND CREATE` feature allows the agent to extend its own capabilities, but executing LLM-generated code in the main process is dangerous. Using `node:vm` provides isolation while still allowing useful computation. In production, this could be upgraded to `isolated-vm` or a WebAssembly runtime for stronger sandboxing.
