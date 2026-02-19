# UI Surfaces Guide

UI Surfaces are a powerful feature in Robodev that allows the AI agent to create, modify, and display custom user interfaces dynamically.

## 1. Concept

A "Surface" is a dedicated tab in the Robodev UI that acts as a canvas for React components. The agent can use tools to:
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

## 4. Workflow Example

1.  **User**: "Show me the current project status."
2.  **Agent**:
    *   Calls `create_surface({ name: "Project Status" })`.
    *   Calls `update_surface_component` to add a "Progress Bar" component showing 75% complete.
    *   Calls `update_surface_component` to add a "Task List" component with recent items.
3.  **User**: Sees the new "Project Status" tab with the dashboard.
4.  **User**: "Update the progress to 80%."
5.  **Agent**: Calls `update_surface_component` again with updated props (`{ progress: 80 }`). The UI updates instantly.
