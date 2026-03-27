# UI Surfaces Guide

UI Surfaces are a powerful feature in Oboto that allows the AI agent to create, modify, and display custom user interfaces dynamically.

## 1. Concept

A "Surface" is a dedicated tab in the Oboto UI that acts as a canvas for React components. The agent can use tools to:
1.  **Create** a new surface (e.g., "Project Dashboard", "Server Monitor").
2.  **Add Components** to that surface (e.g., charts, tables, buttons).
3.  **Update Data** in real-time.

This enables the agent to visualize complex data or create interactive tools for the user on the fly.

## 2. Managing Surfaces

### Creating a Surface
Use the `create_surface` tool.
```json
{
  "name": "System Monitor",
  "description": "Real-time CPU and Memory usage"
}
```

### Listing Surfaces
Use `list_surfaces` to see all active surfaces.

### Deleting Surfaces
Use `delete_surface` to remove a surface when it's no longer needed.

## 3. Adding Components

Use `update_surface_component` to add or update a component. You provide the **JSX source code** for the component.

### Example: Adding a Stat Card
```json
{
  "surface_id": "monitor-123",
  "component_name": "CPUWidget",
  "jsx_source": "({ usage }) => <div className='p-4 bg-zinc-800 rounded'>CPU: {usage}%</div>",
  "props": { "usage": 45 }
}
```

### Supported Components

The frontend supports standard HTML/React elements and a comprehensive set of built-in UI kit components (exposed via the `UI` global):

#### Layout
*   `UI.Card`, `UI.CardHeader`, `UI.CardTitle`, `UI.CardDescription`, `UI.CardContent`, `UI.CardFooter`
*   `UI.Stack` (Flexbox wrapper)
*   `UI.Separator`
*   `UI.ScrollArea`

#### Primitives
*   `UI.Button` (Variants: default, destructive, outline, secondary, ghost, link)
*   `UI.Input`, `UI.TextArea`
*   `UI.Label`
*   `UI.Select`, `UI.SelectItem`
*   `UI.Checkbox`, `UI.Switch`, `UI.Slider`

#### Navigation
*   `UI.Tabs`, `UI.TabsList`, `UI.TabsTrigger`, `UI.TabsContent`
*   `UI.Accordion`, `UI.AccordionItem`, `UI.AccordionTrigger`, `UI.AccordionContent`

#### Data Display
*   `UI.Table` (Responsive data tables)
*   `UI.Badge` (Status indicators)
*   `UI.Avatar`
*   `UI.Progress`
*   `UI.Skeleton` (Loading states)

#### Feedback
*   `UI.Alert`
*   `UI.toast` (Notification)

#### Charts (Recharts wrapper)
*   `UI.LineChart`
*   `UI.BarChart`
*   `UI.PieChart`
*   `UI.AreaChart`
*   `UI.Sparkline`

#### Overlay
*   `UI.Dialog` (Modals)
*   `UI.Popover`
*   `UI.Tooltip`
*   `UI.DropdownMenu`, `UI.DropdownMenuItem`

## 4. Surface API (`surfaceApi`)

The `surfaceApi` global is available to all surface components at runtime. It provides workspace access, agent interaction, state management, and lifecycle hooks.

### Workspace File Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `surfaceApi.readFile(path)` | `Promise<string>` | Read a workspace file (256KB cap) |
| `surfaceApi.writeFile(path, content)` | `Promise<{success, message}>` | Write a workspace file |
| `surfaceApi.listFiles(path?, recursive?)` | `Promise<string[]>` | List workspace files/dirs |
| `surfaceApi.readManyFiles(paths)` | `Promise<{summary, results}>` | Batch-read files (size-capped) |
| `surfaceApi.getConfig(key?)` | `Promise<object>` | Get workspace config (package.json, env vars, etc.) |

### Agent Interaction

| Method | Returns | LLM? | Description |
|--------|---------|------|-------------|
| `surfaceApi.callTool(toolName, args?)` | `Promise<T>` | No | Call a whitelisted server tool directly |
| `surfaceApi.directInvoke(name, args?)` | `Promise<T>` | No | Execute a registered direct action |
| `surfaceApi.fetch(url, options?)` | `Promise<FetchResponse>` | No | Server-side HTTP fetch (avoids CORS) |
| `surfaceApi.fetchRoute(path)` | `Promise<FetchResponse>` | No | Fetch from the workspace content server (auto-resolves localhost port) |
| `surfaceApi.registerAction(name, def)` | `Promise<void>` | No | Register a server-side direct action |
| `surfaceApi.listActions(surfaceId?)` | `Promise<Action[]>` | No | List available direct actions |
| `surfaceApi.callAgent(prompt)` | `Promise<string>` | **Yes** | Send a prompt, get free-text response (use sparingly) |
| `surfaceApi.defineHandler(def)` | `void` | **Yes** | Register a typed handler with input/output schemas |
| `surfaceApi.invoke(name, args?)` | `Promise<T>` | **Yes** | Invoke a handler, get typed JSON response |

### State & Messaging

| Method | Returns | Description |
|--------|---------|-------------|
| `surfaceApi.getState(key)` | `Promise<T>` | Get persisted surface state |
| `surfaceApi.setState(key, value)` | `void` | Set persisted surface state |
| `surfaceApi.sendMessage(type, payload)` | `void` | Send a raw WebSocket message |

### Allowed Tools for `callTool`

`read_file`, `write_file`, `list_files`, `edit_file`, `read_many_files`, `write_many_files`, `search_web`, `list_surfaces`, `list_skills`, `evaluate_math`, `unit_conversion`, `get_image_info`

## 5. Surface Sandboxing & Network Restrictions

UI Surfaces run inside a **strict sandbox** by default to prevent data exfiltration and protect user privacy.

### How It Works

The `fetch` API inside a surface is intercepted at the sandbox boundary. In **strict mode** (the default), only requests to `localhost` origins are allowed. Any attempt to call an external URL will be blocked and an error will be logged.

### Fetching from Workspace Routes

Surfaces should use `surfaceApi.fetchRoute('/path')` to make HTTP requests to the workspace's content server (which serves files from `public/` and, if enabled, executes dynamic routes from `routes/`, `.routes/`, or `api/`). This method automatically resolves the correct `localhost` port for the current workspace.

```jsx
// Fetch from a workspace route — works in both strict and permissive mode
const data = await surfaceApi.fetchRoute('/api/status');
```

### Configuring Sandbox Mode

To relax the sandbox restrictions (e.g., for surfaces that need to call external APIs), set `surface.sandboxMode` to `"permissive"` in the workspace's `.oboto.json`:

```json
{
  "surface": {
    "sandboxMode": "permissive"
  }
}
```

| Mode | `fetch` Behavior | Use Case |
|------|-----------------|----------|
| `"strict"` (default) | Only `localhost` allowed | Production, untrusted surfaces |
| `"permissive"` | All origins allowed | Development, trusted surfaces that call external APIs |

> **Security Note:** The strict sandbox is a defense-in-depth measure. Even in permissive mode, surfaces still run within the Electron/browser sandbox. Use `"permissive"` only when you trust the surface code and understand the implications.

## 6. Surface Lifecycle

Components can react to surface visibility changes using the `useSurfaceLifecycle()` hook (globally available):

```jsx
export default function MyComponent() {
  const lifecycle = useSurfaceLifecycle();
  
  useEffect(() => {
    if (lifecycle.isFocused) {
      // Start polling, animations, etc.
    }
  }, [lifecycle.isFocused]);
  
  useEffect(() => {
    const cleanup = lifecycle.onFocus(() => {
      console.log('Surface tab became visible');
    });
    return cleanup;
  }, []);
  
  useEffect(() => {
    const cleanup = lifecycle.onBlur(() => {
      console.log('Surface tab hidden');
    });
    return cleanup;
  }, []);
  
  return <div>Focused: {lifecycle.isFocused ? 'Yes' : 'No'}</div>;
}
```

**Lifecycle events:**
- `onFocus` — tab switched TO this surface
- `onBlur` — tab switched AWAY from this surface
- `onMount` — surface first rendered
- `onUnmount` — surface being destroyed
- `isFocused` — reactive boolean

## 7. Direct Execution vs LLM Calls

Surface action handlers should prefer **direct execution** over LLM calls wherever possible. Direct execution is faster, cheaper, deterministic, and more reliable.

### When to Use Each API

| Scenario | API | LLM? | Example |
|----------|-----|------|---------|
| Read/write workspace files | `surfaceApi.readFile()` / `writeFile()` | No | Load config, save data |
| Call an existing tool | `surfaceApi.callTool(name, args)` | No | `callTool('list_files', { recursive: true })` |
| HTTP request to external API | `surfaceApi.fetch(url, options)` | No | Fetch data from REST API |
| Multi-step server pipeline | `surfaceApi.directInvoke(name, args)` | No | Registered action combining tool calls |
| In-component computation | Plain JavaScript | No | Parse, filter, compute in the component |
| Complex reasoning/generation | `surfaceApi.callAgent(prompt)` | **Yes** | Code analysis, natural language tasks |

### Direct Tool Call (recommended)
```jsx
export default function FileList() {
  const [files, setFiles] = useState([]);
  
  return (
    <UI.Card>
      <UI.CardContent>
        <UI.Button onClick={async () => {
          // Direct tool call — no LLM involved
          const result = await surfaceApi.callTool('list_files', { path: 'src', recursive: true });
          setFiles(result.split('\n').filter(Boolean));
        }}>
          List Source Files
        </UI.Button>
        {files.map(f => <div key={f} className="text-sm">{f}</div>)}
      </UI.CardContent>
    </UI.Card>
  );
}
```

### Server-Side HTTP Fetch
```jsx
export default function ApiDataWidget() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  
  async function loadData() {
    setLoading(true);
    try {
      // Server-side fetch — avoids CORS, no LLM needed
      const response = await surfaceApi.fetch('https://api.example.com/data', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) setData(response.body);
    } catch (err) {
      UI.toast({ title: 'Failed', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  
  return (
    <UI.Card>
      <UI.CardContent>
        <UI.Button onClick={loadData} disabled={loading}>
          {loading ? 'Loading...' : 'Fetch Data'}
        </UI.Button>
        {data && <pre className="mt-2 text-xs">{JSON.stringify(data, null, 2)}</pre>}
      </UI.CardContent>
    </UI.Card>
  );
}
```

### Registered Direct Actions
```jsx
export default function ProjectAnalyzer() {
  const [result, setResult] = useState(null);
  
  useEffect(() => {
    // Register a pipeline action that runs server-side without LLM
    surfaceApi.registerAction('analyzeProject', {
      type: 'pipeline',
      steps: [
        { type: 'tool', name: 'files', toolName: 'list_files', args: { path: '.', recursive: true } },
        { type: 'tool', name: 'pkg', toolName: 'read_file', args: { path: 'package.json' } }
      ]
    });
  }, []);
  
  return (
    <UI.Button onClick={async () => {
      // Executes server-side pipeline, returns combined results
      const data = await surfaceApi.directInvoke('analyzeProject');
      setResult(data);
    }}>Analyze</UI.Button>
  );
}
```

### Built-in Direct Actions

These actions are pre-registered and available immediately:

| Action Name | Type | Description |
|-------------|------|-------------|
| `readAndParseJson` | function | Read a file and parse as JSON. Args: `{ path }` |
| `readAndParseMarkdownTable` | function | Parse a markdown table section. Args: `{ path, section? }` |
| `listWorkspaceFiles` | tool | List workspace files recursively |
| `searchFiles` | function | Search for pattern in a file. Args: `{ path, pattern, flags? }` |
| `httpGet` | fetch | HTTP GET. Args: `{ url }` or `{ _url }` |
| `httpPost` | fetch | HTTP POST. Args: `{ url, _body }` or `{ _url, _body }` |

### LLM Call (only when reasoning is needed)

Reserve `callAgent` for tasks that genuinely require AI reasoning:

```jsx
export default function AnalyzeButton() {
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  
  return (
    <UI.Card>
      <UI.CardContent>
        <UI.Button onClick={async () => {
          setLoading(true);
          // LLM call — justified because code analysis requires reasoning
          const response = await surfaceApi.callAgent("Analyze the architecture of this project and suggest improvements");
          setResult(response);
          setLoading(false);
        }} disabled={loading}>
          {loading ? 'Analyzing...' : 'AI Architecture Review'}
        </UI.Button>
        {result && <pre className="mt-4 text-sm whitespace-pre-wrap">{result}</pre>}
      </UI.CardContent>
    </UI.Card>
  );
}
```

## 8. Workflow Example

1.  **User**: "Show me the current project status."
2.  **Agent**:
    *   Calls `create_surface({ name: "Project Status" })`.
    *   Calls `update_surface_component` to add a "Progress Bar" component showing 75% complete.
    *   Calls `update_surface_component` to add a "Task List" component with recent items.
3.  **User**: Sees the new "Project Status" tab with the dashboard.
4.  **User**: "Update the progress to 80%."
5.  **Agent**: Calls `update_surface_component` again with updated props (`{ progress: 80 }`). The UI updates instantly.
