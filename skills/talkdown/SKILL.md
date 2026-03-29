---
name: talkdown
description: "Talkdown — An AI-based execution language. Markdown documents are programs, LLMs are the runtime. Supports document chaining, hybrid AI/code execution, pluggable LLM providers, and Next.js-style route deployment."
version: 2.0.0
author: Sebastian Schepis / nomyx-io
---

# Talkdown Skill

**Talkdown** is an AI-based execution language where **Markdown documents are programs** and **LLMs are the runtime**. Each `.md` file is a "function" with inputs, execution logic (AI prompts or real code), outputs, and routing to the next document — creating chainable, human-readable AI workflows.

## Core Concepts

- **Directive**: An atomic, reusable task document (like a function)
- **Process**: A multi-step workflow that chains directives (like a program)
- **Routing**: Control flow — each document's output names the next document to execute
- **`ai` code fence**: A code block "executed" by LLM reasoning (not a traditional runtime)
- **Hybrid execution**: Mix real JavaScript code blocks with AI reasoning blocks in one document

## When To Use This Skill

Use Talkdown when the user wants to:
- Create AI-driven workflows defined in Markdown
- Chain multiple LLM calls together with structured inputs/outputs
- Build reusable prompt templates with execution logic
- Create document-driven automation pipelines
- Define processes that mix code execution with AI reasoning

---

## Deployment: Detect Runtime Environment

**IMPORTANT**: Before deploying, detect whether you are running inside Oboto or a generic environment.

### How to detect Oboto
You are in Oboto if ANY of these are true:
- You have access to `surfaceApi` tools (create_surface, update_surface_component)
- You have access to `write_file` / `read_file` workspace tools
- You can create `.routes/` files for the workspace content server
- The user is interacting with you through the Oboto chat interface

### If Oboto → Deploy with Routes (Section A)
### If Generic → Deploy CLI runner (Section B)

---

## Section A: Oboto Deployment

When running inside Oboto, deploy Talkdown as workspace routes + an interactive surface.

### Step 1: Deploy the Engine Files

Create these files in the user's workspace:

#### `talkdown/parser.mjs`
```javascript
/**
 * Talkdown Parser — Parses Markdown documents into structured executables.
 */
export function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();
    if (val.startsWith('[') && val.endsWith(']'))
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

export function extractSections(body) {
  const sections = new Map();
  const pattern = /^##\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = pattern.exec(body)) !== null)
    headings.push({ name: match[1].trim().toLowerCase(), index: match.index, length: match[0].length });

  if (headings.length > 0 && headings[0].index > 0) {
    const p = body.slice(0, headings[0].index).trim();
    if (p) sections.set('_preamble', p);
  } else if (headings.length === 0) {
    sections.set('_preamble', body.trim());
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length;
    sections.set(headings[i].name, body.slice(start, end).trim());
  }
  return sections;
}

export function extractCodeBlocks(text) {
  const blocks = [];
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(text)) !== null)
    blocks.push({ lang: match[1] || 'text', code: match[2].trim() });
  return blocks;
}

export function extractListItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const rich = line.match(/^[\s]*[-*]\s+\*\*(.+?)\*\*:?\s*_?(.+?)_?\s*[-–]\s*(.+)$/);
    if (rich) { items.push({ name: rich[1].trim(), type: rich[2].trim(), description: rich[3].trim() }); continue; }
    const code = line.match(/^[\s]*[-*]\s+`(.+?)`\s*[-–]?\s*(.*)$/);
    if (code) { items.push({ name: code[1].trim(), description: code[2].trim() || undefined }); continue; }
    const simple = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (simple) items.push({ name: simple[1].trim() });
  }
  return items;
}

export function parse(content) {
  const { meta, body } = parseFrontmatter(content);
  const sections = extractSections(body);
  const inputSection = sections.get('inputs') || sections.get('input') || '';
  const execSection = sections.get('execution') || sections.get('task') || '';
  const outputSection = sections.get('outputs') || sections.get('output') || '';
  const routingSection = sections.get('routing') || '';

  return {
    meta: { title: meta.title || null, description: meta.description || null, ...meta },
    preamble: sections.get('_preamble') || null,
    inputs: extractListItems(inputSection),
    execution: {
      description: execSection.replace(/```\w*\n[\s\S]*?```/g, '').trim(),
      blocks: extractCodeBlocks(execSection),
    },
    outputs: extractListItems(outputSection),
    routing: {
      description: routingSection.replace(/```\w*\n[\s\S]*?```/g, '').trim(),
      blocks: extractCodeBlocks(routingSection),
    },
    examples: sections.get('examples') || null,
    sections,
    raw: content,
  };
}

export default { parse, parseFrontmatter, extractSections, extractCodeBlocks, extractListItems };
```

#### `talkdown/loader.mjs`
```javascript
/**
 * Talkdown Document Loader — Discovers and caches .md documents.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { parse } from './parser.mjs';

export function discoverDocuments(dir) {
  const docs = new Map();
  if (!existsSync(dir)) return docs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [n, p] of discoverDocuments(full)) docs.set(n, p);
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      docs.set(basename(entry.name, '.md'), full);
    }
  }
  return docs;
}

export function loadDocument(filePath) {
  const doc = parse(readFileSync(filePath, 'utf-8'));
  doc._filePath = filePath;
  return doc;
}

export function createLibrary(dir) {
  let registry = new Map();
  let parsed = new Map();

  function reload() { registry = discoverDocuments(dir); parsed.clear(); }

  function get(name) {
    if (name.endsWith('.md')) name = name.slice(0, -3);
    if (parsed.has(name)) return parsed.get(name);
    const fp = registry.get(name);
    if (!fp) return null;
    const doc = loadDocument(fp);
    parsed.set(name, doc);
    return doc;
  }

  function list() { return [...registry.keys()]; }
  function has(name) { if (name.endsWith('.md')) name = name.slice(0, -3); return registry.has(name); }

  reload();
  return { get, list, has, reload, get registry() { return registry; } };
}

export default { discoverDocuments, loadDocument, createLibrary };
```

#### `talkdown/executor.mjs`
```javascript
/**
 * Talkdown Executor — Runs documents, chains workflows via routing.
 */

export function createContext(inputs = {}, state = {}) {
  return { inputs, state, log: [], outputs: {}, previousOutput: null, history: [] };
}

async function executeCodeBlock(block, context) {
  if (block.lang === 'ai') return { type: 'ai', prompt: block.code };
  if (block.lang === 'javascript' || block.lang === 'js') {
    try {
      const fn = new Function('context', 'inputs', 'state', 'outputs', block.code);
      const result = await fn(context, context.inputs, context.state, context.outputs);
      return { type: 'code', result, error: null };
    } catch (err) {
      return { type: 'code', result: null, error: err.message };
    }
  }
  return { type: 'passthrough', lang: block.lang, code: block.code };
}

function buildPrompt(doc, context) {
  const parts = [];
  if (doc.meta.title) parts.push(`# ${doc.meta.title}`);
  if (doc.preamble) parts.push(doc.preamble);

  if (doc.inputs.length > 0) {
    parts.push('## Inputs');
    for (const inp of doc.inputs) {
      const val = context.inputs[inp.name];
      parts.push(`- **${inp.name}**${inp.type ? ` (_${inp.type}_)` : ''}: ${val !== undefined ? val : inp.description || '(not provided)'}`);
    }
  }

  if (context.previousOutput) {
    parts.push('\n## Input Data (from previous step)');
    parts.push(context.previousOutput);
  }

  if (doc.execution.description) {
    parts.push('\n## Task');
    parts.push(doc.execution.description);
  }

  for (const block of doc.execution.blocks) {
    if (block.lang === 'ai') parts.push('\n' + block.code);
  }

  if (doc.outputs.length > 0) {
    parts.push('\n## Expected Output');
    for (const out of doc.outputs)
      parts.push(`- **${out.name}**${out.type ? ` (_${out.type}_)` : ''}: ${out.description || ''}`);
  }

  if (doc.routing.description) {
    parts.push('\n## Routing');
    parts.push(doc.routing.description);
    parts.push('\nEnd your response with: `Routing: <next-document-name>` (or `Routing: none` if finished).');
  }

  return parts.join('\n');
}

export function parseResponse(response) {
  const routingMatch = response.match(/Routing:\s*(.+)/i);
  let next = null;
  let output = response;

  if (routingMatch) {
    next = routingMatch[1].trim();
    output = response.slice(0, routingMatch.index).trim();
    if (['none', 'end', ''].includes(next.toLowerCase())) next = null;
    if (next && next.endsWith('.md')) next = next.slice(0, -3);
  }

  const mdMatch = output.match(/```markdown\n([\s\S]*?)```/);
  if (mdMatch) output = mdMatch[1].trim();

  return { output, next };
}

export async function executeDocument(doc, context, provider) {
  const stepLog = {
    document: doc.meta.title || doc._filePath || 'unknown',
    startedAt: new Date().toISOString(),
    blocks: [], llmCalled: false, output: null, next: null,
  };

  for (const block of doc.execution.blocks) {
    if (block.lang === 'javascript' || block.lang === 'js') {
      const result = await executeCodeBlock(block, context);
      stepLog.blocks.push(result);
      if (result.error) context.log.push(`[ERROR] Code block failed: ${result.error}`);
    }
  }

  const prompt = buildPrompt(doc, context);
  stepLog.llmCalled = true;
  const rawResponse = await provider.complete(prompt, { document: doc.meta.title, inputs: context.inputs, state: context.state });
  const { output, next } = parseResponse(rawResponse);

  stepLog.output = output;
  stepLog.next = next;
  stepLog.completedAt = new Date().toISOString();

  context.log.push(`[EXEC] ${stepLog.document} → ${next || 'END'}`);
  context.history.push(stepLog);
  context.previousOutput = output;
  context.outputs[doc.meta.title || 'result'] = output;

  return { output, next, log: stepLog };
}

export async function executeWorkflow(entryName, library, provider, inputs = {}, options = {}) {
  const maxSteps = options.maxSteps || 50;
  const context = createContext(inputs, options.state || {});
  const onStep = options.onStep || (() => {});

  let currentName = entryName;
  let steps = 0;

  while (currentName && steps < maxSteps) {
    steps++;
    const doc = library.get(currentName);
    if (!doc) { context.log.push(`[ERROR] Document not found: ${currentName}`); break; }
    const result = await executeDocument(doc, context, provider);
    await onStep(result, steps, context);
    currentName = result.next;
  }

  if (steps >= maxSteps) context.log.push(`[WARN] Max steps (${maxSteps}) reached`);

  return { outputs: context.outputs, log: context.log, history: context.history, state: context.state, steps };
}

export default { createContext, executeDocument, executeWorkflow, parseResponse };
```

#### `talkdown/providers.mjs`
```javascript
/**
 * Talkdown LLM Providers — Pluggable backends for OpenAI, Anthropic, Echo.
 */

const DEFAULT_SYSTEM = `You are a Talkdown execution agent. You process structured Markdown documents that define tasks, inputs, and expected outputs. Follow the instructions precisely:
1. Read the document's metadata, inputs, and task description carefully.
2. Execute the task as described, using the provided inputs.
3. Format your output according to the Expected Output section.
4. End your response with: Routing: <next-document-name> (or Routing: none if finished).`;

export function createOpenAIProvider(options = {}) {
  const { apiKey = process.env.OPENAI_API_KEY, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o', temperature = 0.7, maxTokens = 4096, systemPrompt = DEFAULT_SYSTEM } = options;
  return {
    name: `openai/${model}`,
    async complete(prompt) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.choices[0].message.content;
    },
  };
}

export function createAnthropicProvider(options = {}) {
  const { apiKey = process.env.ANTHROPIC_API_KEY, model = 'claude-sonnet-4-20250514', temperature = 0.7, maxTokens = 4096, systemPrompt = DEFAULT_SYSTEM } = options;
  return {
    name: `anthropic/${model}`,
    async complete(prompt) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system: systemPrompt, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return data.content[0].text;
    },
  };
}

export function createEchoProvider() {
  return {
    name: 'echo/test',
    async complete(prompt) {
      return `[Echo] Received prompt (${prompt.length} chars).\n\nProcessed successfully.\n\nRouting: none`;
    },
  };
}

export function createProvider(name = 'openai', options = {}) {
  switch (name) {
    case 'openai': return createOpenAIProvider(options);
    case 'anthropic': return createAnthropicProvider(options);
    case 'echo': return createEchoProvider();
    default: throw new Error(`Unknown provider: ${name}. Available: openai, anthropic, echo`);
  }
}

export default { createProvider, createOpenAIProvider, createAnthropicProvider, createEchoProvider };
```

#### `talkdown/index.mjs`
```javascript
/**
 * Talkdown — An AI-based execution language
 * Markdown documents are programs. LLMs are the runtime.
 */
import { parse } from './parser.mjs';
import { createLibrary } from './loader.mjs';
import { executeWorkflow, executeDocument, createContext } from './executor.mjs';
import { createProvider } from './providers.mjs';

export class Talkdown {
  constructor(docsDir, options = {}) {
    this.library = createLibrary(docsDir);
    this.provider = options.provider
      ? (typeof options.provider === 'string' ? createProvider(options.provider, options.providerOptions || {}) : options.provider)
      : createProvider('echo');
    this.maxSteps = options.maxSteps || 50;
    this.onStep = options.onStep || null;
  }

  list() { return this.library.list(); }
  has(name) { return this.library.has(name); }
  get(name) { return this.library.get(name); }
  parse(content) { return parse(content); }
  reload() { this.library.reload(); }

  async exec(name, inputs = {}) {
    const doc = this.library.get(name);
    if (!doc) throw new Error(`Document not found: ${name}`);
    const context = createContext(inputs);
    return executeDocument(doc, context, this.provider);
  }

  async run(entryName, inputs = {}, options = {}) {
    return executeWorkflow(entryName, this.library, this.provider, inputs, {
      maxSteps: options.maxSteps || this.maxSteps,
      onStep: options.onStep || this.onStep,
      state: options.state || {},
    });
  }
}

export { parse } from './parser.mjs';
export { createLibrary, loadDocument, discoverDocuments } from './loader.mjs';
export { executeWorkflow, executeDocument, createContext, parseResponse } from './executor.mjs';
export { createProvider, createOpenAIProvider, createAnthropicProvider, createEchoProvider } from './providers.mjs';
export default Talkdown;
```

### Step 2: Deploy the Directive Library

Create these files in `talkdown/directives/`:

#### `talkdown/directives/decompose-task.md`
```markdown
---
title: Decompose Task
description: Breaks a complex task into smaller, ordered sub-tasks
inputs: [task]
outputs: [decomposed_tasks]
---

This directive decomposes a given task into a list of smaller, manageable sub-tasks.

## Inputs

- **task**: _string_ - The task to decompose into sub-tasks

## Execution

` ``ai
Analyze the given task and break it down:

1. Identify the main objectives and sub-objectives
2. Break down main objectives into atomic sub-tasks
3. Order sub-tasks by dependency (tasks that depend on others come later)
4. Estimate relative effort for each (small / medium / large)
5. Return a numbered list

Each sub-task should be concrete and actionable — not vague.
` ``

## Output

- **decomposed_tasks**: _array_ - Ordered list of sub-tasks with description and effort estimate

## Routing

Routing: none
```

#### `talkdown/directives/validate-result.md`
```markdown
---
title: Validate Result
description: Validates a task result against a reference for quality and completeness
inputs: [task_result, result_reference]
outputs: [validation_status, remaining_tasks]
---

Validates a task result against a reference. Returns whether the result meets quality standards.

## Inputs

- **task_result**: _string_ - The result to validate
- **result_reference**: _string_ - The reference standard to validate against

## Execution

` ``ai
Compare the task_result against the result_reference:

1. Check for equivalence in quality, detail, and completeness
2. If the result falls short, identify specific gaps
3. For each gap, create a concrete remediation task
4. If the result meets or exceeds the reference, confirm validation

Be specific about what's missing — vague feedback is not useful.
` ``

## Output

- **validation_status**: _boolean_ - true if validated, false if gaps remain
- **remaining_tasks**: _array_ - List of specific tasks to close gaps (empty if validated)

## Routing

Routing: none
```

#### `talkdown/directives/generate-directive.md`
```markdown
---
title: Generate Directive
description: Meta-directive that generates new Talkdown directives from a description
inputs: [name, description]
outputs: [directive_markdown]
---

Generates a new Talkdown directive document. This is a meta-directive — it creates new programs for the system.

## Inputs

- **name**: _string_ - The name of the directive to generate
- **description**: _string_ - What the directive should accomplish

## Execution

` ``ai
Generate a complete Talkdown directive in Markdown format with:

1. YAML frontmatter with title, description, inputs, and outputs
2. A preamble paragraph explaining the directive's purpose
3. An ## Inputs section listing each input with name, type, and description
4. An ## Execution section with an ai code block containing the task prompt
5. An ## Output section listing each output with name, type, and description
6. A ## Routing section (default: Routing: none)

The directive should be self-contained and executable by an LLM.
Wrap the complete directive in a markdown code block.
` ``

## Output

- **directive_markdown**: _string_ - Complete Talkdown directive as Markdown

## Routing

Routing: none
```

#### `talkdown/directives/call-external-api.md`
```markdown
---
title: Call External API
description: Makes an HTTP request to an external API and returns the response
inputs: [url, method, headers, body]
outputs: [response_status, response_body]
---

Makes an HTTP request to an external API endpoint.

## Inputs

- **url**: _string_ - The API endpoint URL
- **method**: _string_ - HTTP method (GET, POST, PUT, DELETE). Default: GET
- **headers**: _object_ - Request headers (optional)
- **body**: _string_ - Request body for POST/PUT (optional)

## Execution

` ``javascript
const method = (inputs.method || 'GET').toUpperCase();
const fetchOptions = { method, headers: inputs.headers || {} };
if (inputs.body && (method === 'POST' || method === 'PUT')) {
  fetchOptions.body = typeof inputs.body === 'string' ? inputs.body : JSON.stringify(inputs.body);
  fetchOptions.headers['Content-Type'] = fetchOptions.headers['Content-Type'] || 'application/json';
}
const res = await fetch(inputs.url, fetchOptions);
const body = await res.text();
context.outputs.response_status = res.status;
context.outputs.response_body = body;
` ``

## Output

- **response_status**: _number_ - HTTP status code
- **response_body**: _string_ - Response body

## Routing

Routing: none
```

#### `talkdown/directives/search-web.md`
```markdown
---
title: Search Web
description: Performs a web search and returns summarized results
inputs: [query, num_results]
outputs: [results]
---

Searches the web for information on a given query.

## Inputs

- **query**: _string_ - The search query
- **num_results**: _number_ - Number of results to return (default: 5)

## Execution

` ``ai
Search the web for the given query. Return the top results with:
- Title
- URL
- Brief summary/snippet

Focus on authoritative, recent sources. Filter out spam and low-quality results.
` ``

## Output

- **results**: _array_ - List of search results with title, url, and summary

## Routing

Routing: none
```

#### `talkdown/directives/generate-data-model.md`
```markdown
---
title: Generate Data Model
description: Generates a data model schema from a natural language description
inputs: [description, format]
outputs: [schema]
---

Generates a structured data model from a description.

## Inputs

- **description**: _string_ - Natural language description of the data to model
- **format**: _string_ - Output format: json-schema, typescript, sql (default: json-schema)

## Execution

` ``ai
Generate a data model based on the description:

1. Identify all entities and their attributes
2. Determine data types for each attribute
3. Identify relationships between entities
4. Add constraints (required fields, unique keys, etc.)
5. Output in the requested format

Be thorough — include all reasonable fields even if not explicitly mentioned.
` ``

## Output

- **schema**: _string_ - The data model in the requested format

## Routing

Routing: none
```

#### `talkdown/directives/generate-user-stories.md`
```markdown
---
title: Generate User Stories
description: Generates user stories from a project description
inputs: [project_description, personas]
outputs: [user_stories]
---

Generates user stories in standard format from a project description.

## Inputs

- **project_description**: _string_ - Description of the project
- **personas**: _array_ - List of user personas (optional)

## Execution

` ``ai
Generate user stories from the project description:

1. Identify key user types/personas (use provided personas or infer them)
2. For each persona, identify their goals and needs
3. Write stories in format: "As a [persona], I want to [action] so that [benefit]"
4. Add acceptance criteria for each story
5. Prioritize: must-have, should-have, nice-to-have

Aim for 8-15 stories covering the core functionality.
` ``

## Output

- **user_stories**: _array_ - User stories with persona, action, benefit, acceptance criteria, and priority

## Routing

Routing: none
```

### Step 3: Deploy Process Library

Create these files in `talkdown/processes/`:

#### `talkdown/processes/researcher.md`
```markdown
---
title: Researcher
description: Multi-step research workflow — from question to comprehensive report
---

A research workflow that takes a topic, searches for information, analyzes findings, and produces a structured report.

## Inputs

- **topic**: _string_ - The research topic or question
- **depth**: _string_ - Research depth: quick, standard, deep (default: standard)

## Execution

` ``ai
You are a thorough research agent. For the given topic:

1. **Frame the question**: Clarify the research question and identify 3-5 sub-questions
2. **Gather information**: Identify key facts, data points, and perspectives
3. **Analyze**: Look for patterns, contradictions, and gaps
4. **Synthesize**: Combine findings into a coherent narrative
5. **Conclude**: Provide clear conclusions and identify remaining open questions

Structure your output as:
- Executive Summary (2-3 sentences)
- Key Findings (bullet points)
- Detailed Analysis (organized by sub-question)
- Conclusions & Open Questions
` ``

## Output

- **report**: _string_ - Structured research report in Markdown

## Routing

Routing: none
```

#### `talkdown/processes/software-developer.md`
```markdown
---
title: Software Developer
description: Code generation workflow — from requirements to implementation with validation
---

A development workflow that takes requirements and produces implementation code with tests.

## Inputs

- **requirements**: _string_ - What the code should do
- **language**: _string_ - Programming language (default: javascript)
- **style**: _string_ - Code style preferences (optional)

## Execution

` ``ai
You are an expert software developer. For the given requirements:

1. **Analyze requirements**: Break down what needs to be built
2. **Design**: Choose appropriate patterns, data structures, and architecture
3. **Implement**: Write clean, well-documented code
4. **Test**: Write unit tests for the implementation
5. **Document**: Add JSDoc/docstrings and a usage example

Output:
- Implementation code in a code block
- Test code in a separate code block
- Brief explanation of design decisions
` ``

## Output

- **code**: _string_ - Implementation code
- **tests**: _string_ - Test code
- **explanation**: _string_ - Design decisions and usage notes

## Routing

Routing: validate-result
```

#### `talkdown/processes/personal-assistant.md`
```markdown
---
title: Personal Assistant
description: Task management workflow — breaks down requests and executes them
---

A personal assistant workflow that interprets a user request, plans steps, and executes them.

## Inputs

- **request**: _string_ - The user's request in natural language
- **context**: _string_ - Additional context (optional)

## Execution

` ``ai
You are a capable personal assistant. For the given request:

1. **Understand**: Parse the request and identify the core need
2. **Plan**: Create a step-by-step plan to fulfill the request
3. **Execute**: Work through each step, providing concrete outputs
4. **Summarize**: Provide a clear summary of what was done and any next steps

Be proactive — anticipate follow-up needs and address them.
Be specific — provide actual content, not just descriptions of what you'd do.
` ``

## Output

- **plan**: _array_ - Steps taken
- **result**: _string_ - The deliverable
- **next_steps**: _array_ - Suggested follow-up actions

## Routing

Routing: none
```

### Step 4: Deploy API Routes

Create these files for the workspace content server:

#### `.routes/api/talkdown/index.mjs`
```javascript
/**
 * GET /api/talkdown — List all available documents
 * POST /api/talkdown — Parse raw Talkdown markdown
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();
    if (val.startsWith('[') && val.endsWith(']'))
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

function extractListItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const rich = line.match(/^[\s]*[-*]\s+\*\*(.+?)\*\*:?\s*_?(.+?)_?\s*[-–]\s*(.+)$/);
    if (rich) { items.push({ name: rich[1].trim(), type: rich[2].trim(), description: rich[3].trim() }); continue; }
    const simple = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (simple) items.push({ name: simple[1].trim() });
  }
  return items;
}

function parseDoc(content) {
  const { meta, body } = parseFrontmatter(content);
  const sections = {};
  const pattern = /^##\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = pattern.exec(body)) !== null)
    headings.push({ name: match[1].trim().toLowerCase(), index: match.index, length: match[0].length });

  let preamble = '';
  if (headings.length > 0 && headings[0].index > 0) preamble = body.slice(0, headings[0].index).trim();
  else if (headings.length === 0) preamble = body.trim();

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length;
    sections[headings[i].name] = body.slice(start, end).trim();
  }

  return {
    meta: { title: meta.title || null, description: meta.description || null, ...meta },
    preamble,
    inputs: extractListItems(sections['inputs'] || sections['input'] || ''),
    outputs: extractListItems(sections['outputs'] || sections['output'] || ''),
  };
}

function discoverMdFiles(dir) {
  const docs = [];
  if (!existsSync(dir)) return docs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) docs.push(...discoverMdFiles(full));
    else if (entry.isFile() && extname(entry.name) === '.md')
      docs.push({ name: basename(entry.name, '.md'), path: full });
  }
  return docs;
}

export async function GET(req, res) {
  try {
    const directiveFiles = discoverMdFiles(join(ROOT, 'talkdown', 'directives'));
    const processFiles = discoverMdFiles(join(ROOT, 'talkdown', 'processes'));

    const directives = directiveFiles.map(f => {
      const doc = parseDoc(readFileSync(f.path, 'utf-8'));
      return { name: f.name, title: doc.meta.title || f.name, description: doc.meta.description || doc.preamble || null, inputs: doc.inputs, outputs: doc.outputs };
    });

    const processes = processFiles.map(f => {
      const doc = parseDoc(readFileSync(f.path, 'utf-8'));
      return { name: f.name, title: doc.meta.title || f.name, description: doc.meta.description || doc.preamble || null, inputs: doc.inputs, outputs: doc.outputs };
    });

    res.json({ directives, processes, total: directives.length + processes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function POST(req, res) {
  try {
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'Missing "content" field' });
    res.json({ parsed: parseDoc(content) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
```

#### `.routes/api/talkdown/documents/[name].mjs`
```javascript
/**
 * GET /api/talkdown/documents/:name — Get a parsed document by name
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();
    if (val.startsWith('[') && val.endsWith(']'))
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

function extractCodeBlocks(text) {
  const blocks = [];
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(text)) !== null)
    blocks.push({ lang: match[1] || 'text', code: match[2].trim() });
  return blocks;
}

function extractListItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const rich = line.match(/^[\s]*[-*]\s+\*\*(.+?)\*\*:?\s*_?(.+?)_?\s*[-–]\s*(.+)$/);
    if (rich) { items.push({ name: rich[1].trim(), type: rich[2].trim(), description: rich[3].trim() }); continue; }
    const simple = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (simple) items.push({ name: simple[1].trim() });
  }
  return items;
}

function fullParse(content) {
  const { meta, body } = parseFrontmatter(content);
  const sections = {};
  const pattern = /^##\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = pattern.exec(body)) !== null)
    headings.push({ name: match[1].trim().toLowerCase(), index: match.index, length: match[0].length });

  let preamble = '';
  if (headings.length > 0 && headings[0].index > 0) preamble = body.slice(0, headings[0].index).trim();
  else if (headings.length === 0) preamble = body.trim();

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length;
    sections[headings[i].name] = body.slice(start, end).trim();
  }

  const execSection = sections['execution'] || sections['task'] || '';
  const routingSection = sections['routing'] || '';

  return {
    meta: { title: meta.title || null, description: meta.description || null, ...meta },
    preamble,
    inputs: extractListItems(sections['inputs'] || sections['input'] || ''),
    execution: { description: execSection.replace(/```\w*\n[\s\S]*?```/g, '').trim(), blocks: extractCodeBlocks(execSection) },
    outputs: extractListItems(sections['outputs'] || sections['output'] || ''),
    routing: { description: routingSection.replace(/```\w*\n[\s\S]*?```/g, '').trim(), blocks: extractCodeBlocks(routingSection) },
    examples: sections['examples'] || null,
  };
}

export async function GET(req, res) {
  const { name } = req.params;
  const dirs = [
    { type: 'directive', path: join(ROOT, 'talkdown', 'directives') },
    { type: 'process', path: join(ROOT, 'talkdown', 'processes') },
    { type: 'template', path: join(ROOT, 'talkdown', 'templates') },
  ];

  for (const dir of dirs) {
    const filePath = join(dir.path, `${name}.md`);
    if (existsSync(filePath)) {
      const doc = fullParse(readFileSync(filePath, 'utf-8'));
      return res.json({ name, type: dir.type, ...doc });
    }
  }

  res.status(404).json({ error: `Document not found: ${name}` });
}
```

### Step 5: Deploy Templates

Create `talkdown/templates/directive.md` and `talkdown/templates/process.md` using the templates from the directive library section above.

### Step 6 (Optional): Build a Talkdown Surface

If the user wants a UI, create a surface with:
- A document browser listing all directives and processes
- An editor for writing/editing Talkdown documents
- A runner panel that executes documents and shows results
- A workflow visualizer showing routing chains

Use `surfaceApi.fetchRoute('/api/talkdown')` to list documents and `surfaceApi.fetchRoute('/api/talkdown/documents/NAME')` to load them.

---

## Section B: Generic CLI Deployment (Non-Oboto)

When NOT running inside Oboto, provide a standalone CLI runner.

### Create `talkdown-cli.mjs` (single-file runner)

Tell the user to create this file and run it with `node talkdown-cli.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Talkdown CLI — Standalone runner for any Node.js environment
 * Usage:
 *   node talkdown-cli.mjs run <document> [--dir ./docs] [--provider openai] [--input key=value]
 *   node talkdown-cli.mjs list [--dir ./docs]
 *   node talkdown-cli.mjs parse <file.md>
 *   node talkdown-cli.mjs init [--dir ./docs]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname, resolve } from 'path';

// ===== INLINE PARSER =====
function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: content.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();
    if (val.startsWith('[') && val.endsWith(']'))
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

function extractCodeBlocks(text) {
  const blocks = [];
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = pattern.exec(text)) !== null) blocks.push({ lang: m[1] || 'text', code: m[2].trim() });
  return blocks;
}

function extractListItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const rich = line.match(/^[\s]*[-*]\s+\*\*(.+?)\*\*:?\s*_?(.+?)_?\s*[-–]\s*(.+)$/);
    if (rich) { items.push({ name: rich[1].trim(), type: rich[2].trim(), description: rich[3].trim() }); continue; }
    const simple = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (simple) items.push({ name: simple[1].trim() });
  }
  return items;
}

function parseTalkdown(content) {
  const { meta, body } = parseFrontmatter(content);
  const sections = {};
  const pattern = /^##\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = pattern.exec(body)) !== null)
    headings.push({ name: match[1].trim().toLowerCase(), index: match.index, length: match[0].length });
  let preamble = '';
  if (headings.length > 0 && headings[0].index > 0) preamble = body.slice(0, headings[0].index).trim();
  else if (headings.length === 0) preamble = body.trim();
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : body.length;
    sections[headings[i].name] = body.slice(start, end).trim();
  }
  const execSection = sections['execution'] || sections['task'] || '';
  const routingSection = sections['routing'] || '';
  return {
    meta: { title: meta.title || null, description: meta.description || null, ...meta },
    preamble, inputs: extractListItems(sections['inputs'] || sections['input'] || ''),
    execution: { description: execSection.replace(/```\w*\n[\s\S]*?```/g, '').trim(), blocks: extractCodeBlocks(execSection) },
    outputs: extractListItems(sections['outputs'] || sections['output'] || ''),
    routing: { description: routingSection.replace(/```\w*\n[\s\S]*?```/g, '').trim(), blocks: extractCodeBlocks(routingSection) },
  };
}

// ===== INLINE LOADER =====
function discoverDocs(dir) {
  const docs = new Map();
  if (!existsSync(dir)) return docs;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) for (const [n, p] of discoverDocs(full)) docs.set(n, p);
    else if (e.isFile() && extname(e.name) === '.md') docs.set(basename(e.name, '.md'), full);
  }
  return docs;
}

// ===== INLINE PROVIDERS =====
const SYSTEM = `You are a Talkdown execution agent. Process the Markdown document precisely. End with: Routing: <next> or Routing: none.`;

function makeProvider(name, opts = {}) {
  if (name === 'echo') return { name: 'echo', complete: async (p) => `[Echo] ${p.length} chars\n\nRouting: none` };
  if (name === 'openai') {
    const key = opts.apiKey || process.env.OPENAI_API_KEY;
    const model = opts.model || 'gpt-4o';
    if (!key) { console.error('Error: Set OPENAI_API_KEY env var or pass --api-key'); process.exit(1); }
    return { name: `openai/${model}`, complete: async (prompt) => {
      const r = await fetch(`${opts.baseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0.7, max_tokens: 4096, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
      return (await r.json()).choices[0].message.content;
    }};
  }
  if (name === 'anthropic') {
    const key = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    const model = opts.model || 'claude-sonnet-4-20250514';
    if (!key) { console.error('Error: Set ANTHROPIC_API_KEY env var or pass --api-key'); process.exit(1); }
    return { name: `anthropic/${model}`, complete: async (prompt) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 4096, temperature: 0.7, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
      return (await r.json()).content[0].text;
    }};
  }
  console.error(`Unknown provider: ${name}`); process.exit(1);
}

// ===== INLINE EXECUTOR =====
function buildPrompt(doc, ctx) {
  const p = [];
  if (doc.meta.title) p.push(`# ${doc.meta.title}`);
  if (doc.preamble) p.push(doc.preamble);
  if (doc.inputs.length) { p.push('## Inputs'); for (const i of doc.inputs) p.push(`- **${i.name}**: ${ctx.inputs[i.name] ?? i.description ?? '(not provided)'}`); }
  if (ctx.prev) { p.push('\n## Input Data (from previous step)'); p.push(ctx.prev); }
  if (doc.execution.description) { p.push('\n## Task'); p.push(doc.execution.description); }
  for (const b of doc.execution.blocks) if (b.lang === 'ai') p.push('\n' + b.code);
  if (doc.outputs.length) { p.push('\n## Expected Output'); for (const o of doc.outputs) p.push(`- **${o.name}**: ${o.description || ''}`); }
  if (doc.routing.description) { p.push('\n## Routing'); p.push(doc.routing.description); p.push('\nEnd with: `Routing: <next>` or `Routing: none`.'); }
  return p.join('\n');
}

function parseResponse(r) {
  const rm = r.match(/Routing:\s*(.+)/i);
  let next = null, output = r;
  if (rm) { next = rm[1].trim(); output = r.slice(0, rm.index).trim(); if (['none','end',''].includes(next.toLowerCase())) next = null; if (next?.endsWith('.md')) next = next.slice(0,-3); }
  return { output, next };
}

// ===== CLI =====
const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

function getInputs() {
  const inputs = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) {
      const [k, ...v] = args[i + 1].split('=');
      inputs[k] = v.join('=');
    }
  }
  return inputs;
}

const dir = resolve(getFlag('dir', '.'));

if (cmd === 'list') {
  const docs = discoverDocs(dir);
  console.log(`\n📚 Talkdown Documents in ${dir}\n`);
  if (docs.size === 0) { console.log('  (none found — run `talkdown init` to create starter docs)'); }
  for (const [name, path] of docs) {
    const doc = parseTalkdown(readFileSync(path, 'utf-8'));
    console.log(`  📄 ${name} — ${doc.meta.description || doc.meta.title || '(no description)'}`);
  }
  console.log();

} else if (cmd === 'parse' && args[1]) {
  const content = readFileSync(resolve(args[1]), 'utf-8');
  console.log(JSON.stringify(parseTalkdown(content), null, 2));

} else if (cmd === 'run' && args[1]) {
  const provider = makeProvider(getFlag('provider', 'openai'), { apiKey: getFlag('api-key', undefined), model: getFlag('model', undefined) });
  const inputs = getInputs();
  const docs = discoverDocs(dir);
  let current = args[1];
  let prev = null;
  let steps = 0;

  console.log(`\n🚀 Running: ${current} (provider: ${provider.name})\n`);

  while (current && steps < 50) {
    steps++;
    const path = docs.get(current);
    if (!path) { console.error(`❌ Document not found: ${current}`); break; }
    const doc = parseTalkdown(readFileSync(path, 'utf-8'));
    console.log(`  ⚡ Step ${steps}: ${doc.meta.title || current}`);

    // Execute JS blocks
    for (const b of doc.execution.blocks) {
      if (b.lang === 'javascript' || b.lang === 'js') {
        try { new Function('inputs', 'context', b.code)(inputs, { outputs: {}, prev }); }
        catch (e) { console.error(`    ⚠️ Code error: ${e.message}`); }
      }
    }

    const prompt = buildPrompt(doc, { inputs, prev });
    const raw = await provider.complete(prompt);
    const { output, next } = parseResponse(raw);

    console.log(`    → ${output.slice(0, 120)}${output.length > 120 ? '...' : ''}`);
    if (next) console.log(`    🔀 Routing to: ${next}`);

    prev = output;
    current = next;
  }

  console.log(`\n✅ Workflow complete (${steps} steps)\n`);
  console.log(prev);

} else if (cmd === 'init') {
  const target = resolve(getFlag('dir', './talkdown-docs'));
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'hello-world.md'), `---
title: Hello World
description: A simple starter directive
inputs: [name]
outputs: [greeting]
---

A simple directive that greets the user by name.

## Inputs

- **name**: _string_ - The name to greet

## Execution

\`\`\`ai
Generate a warm, creative greeting for the person named in the input.
Make it memorable and unique.
\`\`\`

## Output

- **greeting**: _string_ - A personalized greeting

## Routing

Routing: none
`);
  console.log(`\n✨ Initialized Talkdown project at ${target}`);
  console.log(`   Created: hello-world.md`);
  console.log(`\n   Run: node talkdown-cli.mjs run hello-world --dir ${target} --input name=World\n`);

} else {
  console.log(`
  Talkdown CLI — Markdown is code, LLMs are the runtime.

  Usage:
    node talkdown-cli.mjs list [--dir ./docs]
    node talkdown-cli.mjs parse <file.md>
    node talkdown-cli.mjs run <document> [--dir ./docs] [--provider openai|anthropic|echo] [--input key=value] [--model gpt-4o] [--api-key KEY]
    node talkdown-cli.mjs init [--dir ./talkdown-docs]

  Environment:
    OPENAI_API_KEY      — OpenAI API key
    ANTHROPIC_API_KEY   — Anthropic API key
  `);
}
```

---

## Talkdown Document Format Reference

Every Talkdown document follows this structure:

```markdown
---
title: Document Title
description: What this document does
inputs: [input1, input2]
outputs: [output1]
---

Preamble paragraph describing the document's purpose.

## Inputs

- **input1**: _type_ - Description
- **input2**: _type_ - Description (optional)

## Execution

Natural language description of the task.

` ``ai
Prompt for the AI to execute. This is the core "code" of the document.
` ``

Or real code:

` ``javascript
const result = doSomething(inputs.input1);
context.outputs.output1 = result;
` ``

## Output

- **output1**: _type_ - Description of the output

## Routing

Routing: next-document-name
(or: Routing: none)
```

### Key Rules
1. **YAML frontmatter** is required for metadata (title, description, inputs, outputs)
2. **`ai` code blocks** are sent to the LLM as prompts — they are "executed" by reasoning
3. **`javascript`/`js` code blocks** are executed directly via `new Function()`
4. **Routing** determines the next document in the chain — this is the control flow mechanism
5. Documents can be **mixed**: JS code blocks run first, then the full document is sent to the LLM
6. The LLM's response is parsed for `Routing: <target>` to determine the next step

### Available Directives (Built-in)
| Name | Purpose |
|------|---------|
| `decompose-task` | Break a complex task into sub-tasks |
| `validate-result` | Validate output against a quality reference |
| `generate-directive` | Meta: generate new Talkdown directives |
| `call-external-api` | Make HTTP requests (JS execution) |
| `search-web` | Web search via AI |
| `generate-data-model` | Create data model schemas |
| `generate-user-stories` | Generate user stories from project descriptions |

### Available Processes (Built-in)
| Name | Purpose | Routes To |
|------|---------|-----------|
| `researcher` | Full research workflow → report | none |
| `software-developer` | Requirements → code + tests | `validate-result` |
| `personal-assistant` | Natural language request → deliverable | none |

---

## Usage Examples

### Example 1: Execute a single directive
```javascript
// Oboto: via surfaceApi
const result = await surfaceApi.fetchRoute('/api/talkdown/documents/decompose-task');

// CLI:
// node talkdown-cli.mjs run decompose-task --input task="Build a blog platform"
```

### Example 2: Run a workflow chain
```javascript
// Oboto: via the Talkdown class
import { Talkdown } from './talkdown/index.mjs';
const td = new Talkdown('./talkdown/processes', { provider: 'openai' });
const result = await td.run('software-developer', {
  requirements: 'Build a REST API for user management',
  language: 'javascript'
});
// Executes: software-developer.md → validate-result.md → END
```

### Example 3: Create a new directive
```javascript
const td = new Talkdown('./talkdown/directives', { provider: 'openai' });
const result = await td.exec('generate-directive', {
  name: 'summarize-article',
  description: 'Takes a URL and produces a concise summary of the article'
});
// result.output contains a complete new .md directive
```
