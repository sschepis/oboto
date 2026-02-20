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

| Method | Returns | Description |
|--------|---------|-------------|
| `surfaceApi.callAgent(prompt)` | `Promise<string>` | Send a prompt, get free-text response |
| `surfaceApi.defineHandler(def)` | `void` | Register a typed handler with input/output schemas |
| `surfaceApi.invoke(name, args?)` | `Promise<T>` | Invoke a handler, get typed JSON response |
| `surfaceApi.callTool(toolName, args?)` | `Promise<T>` | Call a whitelisted server tool directly |

### State & Messaging

| Method | Returns | Description |
|--------|---------|-------------|
| `surfaceApi.getState(key)` | `Promise<T>` | Get persisted surface state |
| `surfaceApi.setState(key, value)` | `void` | Set persisted surface state |
| `surfaceApi.sendMessage(type, payload)` | `void` | Send a raw WebSocket message |

### Allowed Tools for `callTool`

`read_file`, `write_file`, `list_files`, `edit_file`, `read_many_files`, `write_many_files`, `search_web`, `list_surfaces`, `list_skills`, `evaluate_math`, `unit_conversion`, `get_image_info`

## 5. Surface Lifecycle

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

## 6. Action Buttons (Agent Self-Invocation)

Surface components can include buttons that call the AI assistant:

### Simple (unstructured response)
```jsx
export default function AnalyzeButton() {
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  
  return (
    <UI.Card>
      <UI.CardContent>
        <UI.Button onClick={async () => {
          setLoading(true);
          const response = await surfaceApi.callAgent("Analyze the project structure");
          setResult(response);
          setLoading(false);
        }} disabled={loading}>
          {loading ? 'Analyzing...' : 'Analyze Project'}
        </UI.Button>
        {result && <pre className="mt-4 text-sm">{result}</pre>}
      </UI.CardContent>
    </UI.Card>
  );
}
```

### Typed (structured JSON response)
```jsx
export default function StatsWidget() {
  const [stats, setStats] = useState(null);
  
  useEffect(() => {
    surfaceApi.defineHandler({
      name: 'getProjectStats',
      description: 'Count files, lines of code, and dependencies',
      type: 'query',
      outputSchema: {
        type: 'object',
        properties: {
          totalFiles: { type: 'number' },
          linesOfCode: { type: 'number' },
          dependencies: { type: 'number' }
        }
      }
    });
  }, []);
  
  return (
    <UI.Button onClick={async () => {
      const data = await surfaceApi.invoke('getProjectStats');
      setStats(data);
    }}>Get Stats</UI.Button>
  );
}
```

## 7. Workflow Example

1.  **User**: "Show me the current project status."
2.  **Agent**:
    *   Calls `create_surface({ name: "Project Status" })`.
    *   Calls `update_surface_component` to add a "Progress Bar" component showing 75% complete.
    *   Calls `update_surface_component` to add a "Task List" component with recent items.
3.  **User**: Sees the new "Project Status" tab with the dashboard.
4.  **User**: "Update the progress to 80%."
5.  **Agent**: Calls `update_surface_component` again with updated props (`{ progress: 80 }`). The UI updates instantly.
