# Route Management Skill

This skill teaches the agent how to configure route mappings for the workspace content server.

## Overview

The workspace content server serves files and surfaces from the current workspace. By default, it serves:
- `/images/` -> `public/generated-images/`
- `/` -> `public/` (if exists)
- `/surface/:id` -> Surface HTML Preview

You can customize this behavior by creating a `.route-map.json` file in the workspace root.

## Route Map Configuration

The `.route-map.json` file is a JSON object where keys are external routes and values are internal targets.

### Rules
1.  **Exclusivity**: If `.route-map.json` exists, DEFAULT ROUTES ARE DISABLED. Only mapped routes will work.
2.  **Wildcards**: Use `/*` at the end of both key and value to map a directory.
3.  **Surfaces**: Use `surface:<id>` as the target to serve a UI Surface.
4.  **Files**: Map a specific route to a specific file path.

### Schema Example

```json
{
  "/assets/*": "public/assets/*",
  "/gallery/*": "public/generated-images/*",
  "/dashboard": "surface:dashboard-main",
  "/about": "public/about.html"
}
```

### Usage

To configure routes, simply create or update the `.route-map.json` file using the `write_file` tool.

**Example Task:** "Map the generated images to /photos and the dashboard surface to /app"

**Action:**
```json
{
  "path": ".route-map.json",
  "content": "{\n  \"/photos/*\": \"public/generated-images/*\",\n  \"/app\": \"surface:dashboard\"\n}"
}
```

## Best Practices

- Always map `public/generated-images/*` to *some* route if you expect image generation to work properly. The system will automatically detect the mapped route for new images.
- Use distinct prefixes to avoid collisions.
