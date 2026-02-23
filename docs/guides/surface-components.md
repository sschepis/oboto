# Surface UI Component Reference

This document lists all available UI components for Surface development. Use **ONLY** these components when building surfaces.

## Layout Components

| Component | Description |
|-----------|-------------|
| `UI.Card` | Container card |
| `UI.CardHeader` | Card header section |
| `UI.CardTitle` | Card title text |
| `UI.CardDescription` | Card description text |
| `UI.CardContent` | Card content section |
| `UI.CardFooter` | Card footer section |
| `UI.ScrollArea` | Scrollable container |
| `UI.Separator` | Horizontal divider |
| `UI.Collapsible` | Collapsible container |
| `UI.CollapsibleTrigger` | Trigger for collapsible |
| `UI.CollapsibleContent` | Content of collapsible |

## Primitive Components

| Component | Props | Description |
|-----------|-------|-------------|
| `UI.Button` | `variant="default\|destructive\|outline\|secondary\|ghost\|link"`, `size="default\|sm\|lg\|icon"` | Button element |
| `UI.Input` | Standard input props | Text input |
| `UI.Textarea` | Standard textarea props | Multiline input |
| `UI.Label` | `htmlFor` | Form label |
| `UI.Checkbox` | `checked`, `onCheckedChange` | Checkbox |
| `UI.Switch` | `checked`, `onCheckedChange` | Toggle switch |
| `UI.Slider` | `value`, `onValueChange`, `min`, `max`, `step` | Range slider |

## Select Components

```jsx
<UI.Select value={value} onValueChange={setValue}>
  <UI.SelectTrigger>
    <UI.SelectValue placeholder="Select..." />
  </UI.SelectTrigger>
  <UI.SelectContent>
    <UI.SelectItem value="option1">Option 1</UI.SelectItem>
    <UI.SelectItem value="option2">Option 2</UI.SelectItem>
  </UI.SelectContent>
</UI.Select>
```

## Navigation Components

### Tabs
```jsx
<UI.Tabs value={activeTab} onValueChange={setActiveTab}>
  <UI.TabsList>
    <UI.TabsTrigger value="tab1">Tab 1</UI.TabsTrigger>
    <UI.TabsTrigger value="tab2">Tab 2</UI.TabsTrigger>
  </UI.TabsList>
  <UI.TabsContent value="tab1">Content 1</UI.TabsContent>
  <UI.TabsContent value="tab2">Content 2</UI.TabsContent>
</UI.Tabs>
```

### Accordion
```jsx
<UI.Accordion type="single" collapsible>
  <UI.AccordionItem value="item1">
    <UI.AccordionTrigger>Section 1</UI.AccordionTrigger>
    <UI.AccordionContent>Content 1</UI.AccordionContent>
  </UI.AccordionItem>
</UI.Accordion>
```

## Data Display Components

### Table
```jsx
<UI.Table>
  <UI.TableHeader>
    <UI.TableRow>
      <UI.TableHead>Column 1</UI.TableHead>
      <UI.TableHead>Column 2</UI.TableHead>
    </UI.TableRow>
  </UI.TableHeader>
  <UI.TableBody>
    <UI.TableRow>
      <UI.TableCell>Value 1</UI.TableCell>
      <UI.TableCell>Value 2</UI.TableCell>
    </UI.TableRow>
  </UI.TableBody>
</UI.Table>
```

| Component | Props | Description |
|-----------|-------|-------------|
| `UI.Badge` | `variant="default\|secondary\|destructive\|outline"` | Status badge |
| `UI.Avatar` | - | Avatar container |
| `UI.AvatarImage` | `src`, `alt` | Avatar image |
| `UI.AvatarFallback` | - | Avatar fallback text |
| `UI.Progress` | `value` (0-100) | Progress bar |
| `UI.Skeleton` | `className` | Loading placeholder |

## Feedback Components

### Alert
```jsx
// ✅ CORRECT - use div/span for content
<UI.Alert>
  <div className="font-semibold">Alert Title</div>
  <div className="text-sm">Alert description text</div>
</UI.Alert>

// ❌ WRONG - these don't exist
<UI.Alert>
  <UI.AlertTitle>Title</UI.AlertTitle>
  <UI.AlertDescription>Description</UI.AlertDescription>
</UI.Alert>
```

### Toast
```jsx
UI.toast({ 
  title: "Success", 
  description: "Operation completed",
  variant: "default" // or "destructive"
});
```

## Chart Components

| Component | Props |
|-----------|-------|
| `UI.LineChart` | `data`, `xKey`, `yKeys`, `colors` |
| `UI.BarChart` | `data`, `xKey`, `yKeys`, `colors`, `stacked` |
| `UI.PieChart` | `data`, `nameKey`, `valueKey`, `colors` |
| `UI.AreaChart` | `data`, `xKey`, `yKeys`, `colors`, `gradient` |
| `UI.Sparkline` | `data`, `valueKey`, `color` |

## Icons (Lucide)

All icons are available via `UI.Icons.{Name}`:

### Common Icons
- Navigation: `ChevronDown`, `ChevronRight`, `ChevronUp`, `ChevronLeft`
- Actions: `Check`, `X`, `Plus`, `Minus`, `Edit`, `Trash`, `Copy`
- Files: `File`, `Folder`, `Download`, `Upload`
- UI: `Search`, `Settings`, `User`, `Home`
- Status: `AlertCircle`, `Info`, `CheckCircle`, `XCircle`
- Utility: `RefreshCw`, `Loader2`, `Activity`, `Terminal`

### Usage
```jsx
<UI.Icons.Check className="w-4 h-4" />
<UI.Icons.Loader2 className="w-4 h-4 animate-spin" />
```

## ⚠️ Components That DO NOT Exist

These will cause React Error #130 if used:

| Invalid | Use Instead |
|---------|-------------|
| `UI.AlertTitle` | `<div className="font-semibold">` |
| `UI.AlertDescription` | `<div className="text-sm">` |
| `UI.Stack` | `<div className="flex flex-col gap-2">` |
| `UI.Icons.Atom` | Use `Activity` or similar |
| `UI.Icons.Orbit` | Use `RefreshCw` or similar |
| `UI.Icons.Cpu` | Use `Terminal` or similar |

## Global APIs

### React Hooks (no import needed)
- `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`

### Surface API
- `surfaceApi.readFile(path)` → Promise<string>
- `surfaceApi.writeFile(path, content)` → Promise<{success, message}>
- `surfaceApi.listFiles(path?, recursive?)` → Promise<string[]>
- `surfaceApi.callAgent(prompt)` → Promise<string>
- `surfaceApi.callTool(toolName, args?)` → Promise<T>
- `surfaceApi.getState(key)` / `surfaceApi.setState(key, value)`

### Lifecycle Hook
```jsx
const lifecycle = useSurfaceLifecycle();
// lifecycle.isFocused — boolean
// lifecycle.onFocus(cb) — returns cleanup fn
// lifecycle.onBlur(cb) — returns cleanup fn
```
