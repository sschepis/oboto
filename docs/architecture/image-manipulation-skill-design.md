# Graphic Design Skill Package — Design Document

## 1. Summary

This document defines a **self-contained graphic design skill package** following the OpenClaw skill architecture conventions. The skill package:

1. Lives at `skills/graphic-design/` in the global skills directory
2. Bundles executable scripts (Node.js) for image manipulation operations
3. Provides graphic design domain knowledge via progressive disclosure
4. Eliminates the need for image tools to be hardcoded in the base application

The existing image tools (`generate_image`, `create_image_variation`, `manipulate_image`, `get_image_info`) will be **removed from the base app** and their functionality will be absorbed into the skill's bundled scripts.

---

## 2. OpenClaw Skill Architecture Overview

Based on analysis of the OpenClaw codebase (`/Users/sschepis/Development/openclaw`), skills follow this architecture:

### 2.1 Anatomy

```
skill-name/
├── SKILL.md              # Required - YAML frontmatter + markdown instructions
├── scripts/              # Optional - Executable code for deterministic tasks
├── references/           # Optional - Documentation loaded on-demand into context
└── assets/               # Optional - Files used in output, not loaded into context
```

### 2.2 Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (name + description) — Always in context via `<available_skills>` (~100 words)
2. **SKILL.md body** — Loaded only when the skill triggers (agent reads it with `read_file`)
3. **Bundled resources** — Scripts executed without loading into context; references loaded as needed

### 2.3 Frontmatter Format

```yaml
---
name: skill-name
description: What the skill does and when to use it. This is the primary triggering mechanism.
metadata:
  {
    "openclaw": {
      "emoji": "🎨",
      "requires": { "bins": ["node"], "env": ["OPENAI_API_KEY"] },
      "primaryEnv": "OPENAI_API_KEY",
      "install": [...]
    }
  }
---
```

### 2.4 Script Execution Pattern

Skills invoke scripts via shell commands with `{baseDir}` as a placeholder for the skill directory:

```bash
node {baseDir}/scripts/create-canvas.mjs --width 1080 --height 1080 --bg "#1a237e" --output canvas.png
```

The agent generates these commands based on the SKILL.md instructions and executes them via `run_command` or equivalent shell tool.

---

## 3. Skill Package Structure

```
skills/graphic-design/
├── SKILL.md
├── scripts/
│   ├── create-canvas.mjs       # Create blank canvases with solid/gradient backgrounds
│   ├── manipulate-image.mjs    # Pipeline of sharp operations on existing images
│   ├── draw-shapes.mjs         # Draw geometric shapes via SVG overlay
│   ├── render-text.mjs         # Rich text rendering with fonts, shadows, outlines
│   ├── color-adjust.mjs        # Brightness, saturation, hue, gamma adjustments
│   ├── add-border.mjs          # Borders, padding, rounded corners
│   ├── generate-svg.mjs        # Create standalone SVG files
│   ├── image-info.mjs          # Get image metadata
│   ├── generate-image.mjs      # AI image generation via OpenAI DALL-E
│   ├── batch-process.mjs       # Apply operations to multiple files
│   └── composite-layers.mjs    # Multi-layer image composition
├── references/
│   ├── design-templates.md     # Standard dimensions for social media, print, etc.
│   ├── color-theory.md         # Color palettes, harmony, contrast guidelines
│   └── typography-guide.md     # Font pairing, hierarchy, readability
└── assets/
    └── fonts/                  # Bundled web-safe font files if needed
```

---

## 4. SKILL.md Content

```markdown
---
name: graphic-design
description: >
  Comprehensive graphic design and image manipulation skill. Create canvases,
  draw shapes, render rich text, adjust colors, compose multi-layer designs,
  generate AI images, and produce social media graphics, banners, thumbnails,
  logos, and badges. Use when the user asks to create, edit, or manipulate
  images, generate graphics, design visual content, or work with image files
  in any capacity including resizing, cropping, converting formats, adding
  text overlays, or creating compositions.
metadata:
  {
    "openclaw": {
      "emoji": "🎨",
      "requires": { "bins": ["node"], "env": [] },
      "primaryEnv": "OPENAI_API_KEY",
      "install": [
        {
          "id": "node-brew",
          "kind": "brew",
          "formula": "node",
          "bins": ["node"],
          "label": "Install Node.js via brew"
        }
      ]
    }
  }
---

# Graphic Design Skill

Create and manipulate images using bundled Node.js scripts powered by sharp.

## Quick Reference

All scripts use the pattern: `node {baseDir}/scripts/<script>.mjs [options]`

Scripts require `sharp` to be available. If not installed globally,
run: `npm install -g sharp` or ensure it is in the workspace node_modules.

## Core Scripts

### Create Canvas

Create a blank canvas with solid color or gradient background.

```bash
# Solid color
node {baseDir}/scripts/create-canvas.mjs --width 1080 --height 1080 --bg "#1a237e" --output canvas.png

# Linear gradient
node {baseDir}/scripts/create-canvas.mjs --width 1920 --height 1080 --gradient-type linear --colors "#ff0000,#0000ff" --angle 135 --output gradient.png

# Radial gradient
node {baseDir}/scripts/create-canvas.mjs --width 800 --height 800 --gradient-type radial --colors "#ffffff,#000000" --output radial.png
```

### Manipulate Image

Apply a pipeline of operations to an image.

```bash
node {baseDir}/scripts/manipulate-image.mjs --input photo.jpg --output result.png --ops '[
  {"type": "resize", "width": 800, "height": 600, "fit": "cover"},
  {"type": "rotate", "angle": 90},
  {"type": "blur", "sigma": 3},
  {"type": "grayscale"},
  {"type": "sharpen"},
  {"type": "flip"},
  {"type": "flop"},
  {"type": "crop", "left": 10, "top": 10, "width": 500, "height": 400},
  {"type": "convert", "format": "webp", "quality": 85},
  {"type": "composite", "overlay": "watermark.png", "gravity": "southeast"},
  {"type": "extend", "top": 20, "bottom": 20, "left": 20, "right": 20, "background": "#ffffff"},
  {"type": "trim"},
  {"type": "negate"},
  {"type": "normalize"},
  {"type": "gamma", "value": 2.2},
  {"type": "modulate", "brightness": 1.2, "saturation": 0.8, "hue": 30},
  {"type": "threshold", "value": 128},
  {"type": "median", "size": 3},
  {"type": "flatten", "background": "#ffffff"},
  {"type": "tint", "color": "#ff000040"}
]'
```

### Draw Shapes

Draw geometric shapes onto an image via SVG overlay compositing.

```bash
node {baseDir}/scripts/draw-shapes.mjs --input canvas.png --output result.png --shapes '[
  {"type": "rectangle", "x": 50, "y": 50, "width": 200, "height": 100, "fill": "#ff0000", "opacity": 0.8, "radius": 10},
  {"type": "circle", "cx": 400, "cy": 300, "radius": 80, "fill": "none", "stroke": "#00ff00", "strokeWidth": 3},
  {"type": "ellipse", "cx": 600, "cy": 400, "rx": 120, "ry": 60, "fill": "#0000ff40"},
  {"type": "line", "x1": 0, "y1": 0, "x2": 1080, "y2": 1080, "stroke": "white", "strokeWidth": 2}
]'
```

### Render Text

Rich text rendering with font control, multi-line, shadows, and outlines.

```bash
node {baseDir}/scripts/render-text.mjs --input canvas.png --output result.png --blocks '[
  {
    "text": "NEW ARRIVAL",
    "x": 540, "y": 400,
    "fontSize": 72, "fontWeight": "bold",
    "color": "white", "align": "center",
    "fontFamily": "sans-serif",
    "shadow": {"color": "rgba(0,0,0,0.5)", "dx": 2, "dy": 2, "blur": 4},
    "outline": {"color": "black", "width": 2}
  },
  {
    "text": "Spring Collection 2026",
    "x": 540, "y": 500,
    "fontSize": 36,
    "color": "rgba(255,255,255,0.9)",
    "align": "center",
    "fontFamily": "serif"
  }
]'
```

### Color Adjust

Adjust brightness, saturation, hue, gamma, and apply effects.

```bash
node {baseDir}/scripts/color-adjust.mjs --input photo.jpg --output adjusted.jpg \
  --brightness 1.2 --saturation 1.5 --hue 15 --gamma 2.2
node {baseDir}/scripts/color-adjust.mjs --input photo.jpg --output bw.jpg --negate
node {baseDir}/scripts/color-adjust.mjs --input photo.jpg --output enhanced.jpg --normalize
node {baseDir}/scripts/color-adjust.mjs --input photo.jpg --output tinted.jpg --tint "#ff000040"
```

### Add Border

Add borders, padding, or rounded corners.

```bash
node {baseDir}/scripts/add-border.mjs --input photo.jpg --output framed.jpg \
  --width 20 --color "#000000"
node {baseDir}/scripts/add-border.mjs --input photo.jpg --output padded.jpg \
  --top 40 --bottom 40 --left 20 --right 20 --color "white"
node {baseDir}/scripts/add-border.mjs --input photo.jpg --output rounded.jpg \
  --radius 30
```

### Generate SVG

Create standalone SVG files for icons, logos, and badges.

```bash
node {baseDir}/scripts/generate-svg.mjs --output icon.svg --width 512 --height 512 \
  --bg transparent --elements '[
  {"type": "circle", "attrs": {"cx": 256, "cy": 256, "r": 240, "fill": "#4CAF50"}},
  {"type": "text", "attrs": {"x": 256, "y": 280, "textAnchor": "middle", "fill": "white", "fontSize": 200, "fontWeight": "bold"}, "content": "✓"}
]' --rasterize result.png --scale 2
```

### Image Info

Get metadata about an image.

```bash
node {baseDir}/scripts/image-info.mjs --input photo.jpg
# Output: JSON with format, width, height, channels, hasAlpha, size, density, space
```

### Generate Image (AI)

Generate images using OpenAI DALL-E. Requires OPENAI_API_KEY env var.

```bash
node {baseDir}/scripts/generate-image.mjs --prompt "a serene mountain landscape at sunset" \
  --size 1024x1024 --quality hd --style natural --output landscape.png
```

### Batch Process

Apply the same operations to multiple files.

```bash
node {baseDir}/scripts/batch-process.mjs --glob "photos/*.jpg" --output-dir thumbnails/ \
  --suffix "_thumb" --ops '[{"type": "resize", "width": 300, "height": 300, "fit": "cover"}]'
```

### Composite Layers

Compose multiple images into a single output with positioning.

```bash
node {baseDir}/scripts/composite-layers.mjs --width 1080 --height 1080 --output final.png --layers '[
  {"input": "background.png", "gravity": "center"},
  {"input": "product.png", "top": 200, "left": 300},
  {"input": "logo.png", "gravity": "southeast", "top": 40, "left": 40}
]'
```

## Design Templates

For standard dimensions for social media, print, and web formats,
read the reference: `{baseDir}/references/design-templates.md`

## Color Theory & Typography

For color palette guidance and font pairing advice:
- **Color theory**: `{baseDir}/references/color-theory.md`
- **Typography**: `{baseDir}/references/typography-guide.md`

## Workflow Strategy

### Social Media Post

1. Create canvas with template dimensions (see design-templates.md)
2. Draw background shapes or apply gradient
3. Render headline and subtext
4. Composite product image or photo
5. Add logo overlay
6. Export

### Photo Enhancement

1. Get image info to understand dimensions and format
2. Apply color adjustments (brightness, saturation, normalize)
3. Optionally resize or crop
4. Add border or frame if needed
5. Convert to target format

### Batch Processing

1. Get image info on a sample file
2. Define the operations pipeline
3. Run batch-process with glob pattern
4. Verify a sample output

### Logo/Badge Creation

1. Generate SVG with shapes and text
2. Optionally rasterize at 2x or 3x scale for crisp output
3. Create size variants (16, 48, 128, 256, 512) via batch-process
```

---

## 5. Implementation Plan

### 5.1 Files to Create

| File | Purpose |
|------|---------|
| `skills/graphic-design/SKILL.md` | Skill definition (content shown in Section 4) |
| `skills/graphic-design/scripts/create-canvas.mjs` | Blank canvas creation with gradients |
| `skills/graphic-design/scripts/manipulate-image.mjs` | Sharp pipeline operations |
| `skills/graphic-design/scripts/draw-shapes.mjs` | SVG shape overlay compositing |
| `skills/graphic-design/scripts/render-text.mjs` | Rich text rendering |
| `skills/graphic-design/scripts/color-adjust.mjs` | Color/brightness/saturation adjustments |
| `skills/graphic-design/scripts/add-border.mjs` | Borders, padding, rounded corners |
| `skills/graphic-design/scripts/generate-svg.mjs` | Standalone SVG creation + optional rasterization |
| `skills/graphic-design/scripts/image-info.mjs` | Image metadata reader |
| `skills/graphic-design/scripts/generate-image.mjs` | AI image generation (OpenAI DALL-E) |
| `skills/graphic-design/scripts/batch-process.mjs` | Batch operations on multiple files |
| `skills/graphic-design/scripts/composite-layers.mjs` | Multi-layer compositing |
| `skills/graphic-design/references/design-templates.md` | Standard dimensions reference |
| `skills/graphic-design/references/color-theory.md` | Color palette guidance |
| `skills/graphic-design/references/typography-guide.md` | Font pairing and hierarchy |

### 5.2 Files to Remove from Base App

| File | Action |
|------|--------|
| [`src/tools/definitions/image-tools.mjs`](src/tools/definitions/image-tools.mjs:1) | Delete entirely |
| [`src/execution/handlers/image-handlers.mjs`](src/execution/handlers/image-handlers.mjs:1) | Delete entirely |

### 5.3 Files to Modify in Base App

| File | Change |
|------|--------|
| [`src/tools/tool-definitions.mjs`](src/tools/tool-definitions.mjs:1) | Remove `IMAGE_TOOLS` import, export, and from `TOOLS` array |
| [`src/execution/tool-executor.mjs`](src/execution/tool-executor.mjs:1) | Remove `ImageHandlers` import, constructor, and 4 tool registrations (lines 43, 143, 410-413) |

### 5.4 Step-by-Step Implementation Order

1. **Create skill directory structure** — `skills/graphic-design/` with `scripts/`, `references/`, and `assets/` subdirectories

2. **Implement scripts (priority order)**:
   - `image-info.mjs` — Simplest, no dependencies beyond sharp
   - `create-canvas.mjs` — Canvas creation with solid/gradient support
   - `manipulate-image.mjs` — Port all operations from [`ImageHandlers.manipulateImage()`](src/execution/handlers/image-handlers.mjs:205), plus the new operations (extend, tint, modulate, negate, normalize, gamma, threshold, median, flatten, trim)
   - `draw-shapes.mjs` — SVG overlay compositing for shapes
   - `render-text.mjs` — Rich SVG text rendering
   - `color-adjust.mjs` — Wrapper around sharp modulate/negate/normalize/gamma/threshold
   - `add-border.mjs` — sharp.extend() for borders, SVG mask for rounded corners
   - `generate-svg.mjs` — SVG XML builder with optional rasterization
   - `generate-image.mjs` — Port from [`ImageHandlers.generateImage()`](src/execution/handlers/image-handlers.mjs:19) (OpenAI DALL-E API)
   - `composite-layers.mjs` — Multi-layer compositing with sharp.composite()
   - `batch-process.mjs` — Glob-based batch processing

3. **Write reference documents**:
   - `references/design-templates.md`
   - `references/color-theory.md`
   - `references/typography-guide.md`

4. **Write SKILL.md** — Full skill definition with frontmatter and instructions

5. **Remove from base app**:
   - Delete [`image-tools.mjs`](src/tools/definitions/image-tools.mjs:1) and [`image-handlers.mjs`](src/execution/handlers/image-handlers.mjs:1)
   - Update [`tool-definitions.mjs`](src/tools/tool-definitions.mjs:1) and [`tool-executor.mjs`](src/execution/tool-executor.mjs:1)

6. **Test** — Verify skill loads, scripts execute, and existing image workflows still work

---

## 6. Script Architecture

### 6.1 Common Pattern

Every script follows this pattern:

```javascript
#!/usr/bin/env node
// scripts/script-name.mjs

import sharp from 'sharp';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o' },
    // ... script-specific options
  }
});

async function main() {
  // ... implementation
  // Output JSON result to stdout for agent consumption
  console.log(JSON.stringify({ success: true, output: values.output, details: info }));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
```

### 6.2 Sharp Dependency Resolution

Scripts import `sharp` directly. Resolution order:
1. Workspace `node_modules/sharp`
2. Global `node_modules/sharp`
3. The base app already has `sharp` as a dependency (v0.34.5 in [`package.json`](package.json:116))

If sharp isn't resolvable from the script's location, the SKILL.md instructs the agent to either:
- Run `npm install sharp` in the workspace
- Or symlink to the global installation

### 6.3 Argument Parsing

All scripts use Node.js built-in `parseArgs` (available since Node 18.3+) to avoid external dependencies. Complex arguments (like operation arrays) are passed as JSON strings.

### 6.4 Output Protocol

All scripts output a JSON object to stdout:
- **Success**: `{ "success": true, "output": "<path>", "details": {...} }`
- **Error**: `{ "error": "<message>" }`

This allows the agent to parse results deterministically.

---

## 7. What Changes for the Agent

### Before (Base App Image Tools)

The agent called tools directly via the tool-calling interface:
```
Tool: manipulate_image
Arguments: { input_path: "photo.jpg", operations: [...] }
```

### After (Skill-Based Scripts)

The agent reads the SKILL.md, then executes scripts via `run_command`:
```
Tool: run_command
Arguments: { command: "node /path/to/skills/graphic-design/scripts/manipulate-image.mjs --input photo.jpg --output result.jpg --ops '[...]'" }
```

### Trade-offs

| Aspect | Before (Built-in Tools) | After (Skill Scripts) |
|--------|------------------------|----------------------|
| **Discovery** | Always available as tool schemas | Discovered via skill metadata, loaded on demand |
| **Invocation** | Direct tool call | Shell command via run_command |
| **Context cost** | Tool schemas always in context | Only name + description until triggered |
| **Extensibility** | Requires code changes to base app | Edit SKILL.md or add scripts |
| **Portability** | Tied to this application | Portable to any OpenClaw-compatible system |
| **Debugging** | Tool handler error handling | Script exit codes + JSON output |
| **Dependencies** | Bundled with app | Requires sharp resolvable from script location |

---

## 8. Design Decisions

### 8.1 Why Node.js Scripts (not Python)?

- The base app is Node.js; `sharp` is already a dependency
- No additional runtime required (Python would need separate installation)
- `sharp` is the most capable Node.js image library
- Scripts can be run directly with `node` — no virtual environment or package manager needed

### 8.2 Why Move Tools Out of Base App?

Per the user's directive: keep the base app clean and focused on core functionality. Image manipulation is a specialized capability that belongs in a skill package, not in the core tool registry.

### 8.3 Why Not Use `{baseDir}` to Resolve Sharp?

The scripts import sharp normally. If sharp is installed in the workspace or globally, it resolves. The SKILL.md includes instructions for the agent to install sharp if needed. This is simpler than path manipulation and follows the pattern used by other OpenClaw skills.

### 8.4 Progressive Disclosure

- **Level 1** (always in context): `"Comprehensive graphic design and image manipulation skill..."` (~50 words)
- **Level 2** (when triggered): SKILL.md body with script usage examples (~400 lines)
- **Level 3** (on demand): Reference files for design templates, color theory, typography

---

## 9. Risk Assessment

| Risk | Mitigation |
|------|------------|
| `sharp` not resolvable from script location | SKILL.md includes installation instructions; scripts detect and report the error clearly |
| JSON argument parsing fragile for complex operations | Use `parseArgs` with clear error messages; accept both file path and inline JSON |
| SVG text rendering varies across systems | Use web-safe fonts as defaults; document limitations |
| Breaking change for users relying on `manipulate_image` tool | Migration period: keep tools for one version with deprecation warning, then remove |
| Scripts not executable on Windows | Use `node script.mjs` invocation (not shebang); all scripts are cross-platform |
| SVG injection via user text | All text content XML-escaped in SVG generation |
