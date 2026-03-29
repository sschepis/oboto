---
name: comfyui-media-generator
description: Generates images, videos, and animations via local ComfyUI. Builds workflow DAGs programmatically, submits to ComfyUI API, polls for results. Supports text-to-image, image-to-image, image-to-video (SVD), and AnimateDiff. Includes beauty product photography templates. Designed for M4 Mac with 128GB RAM.
version: 1.0.0
triggers:
  - generate image
  - generate video
  - create product shot
  - beauty photography
  - comfyui
  - product assets
  - generate assets
  - text to image
  - image to video
  - animate
  - product photography
---

# ComfyUI Media Generator Skill

Generates images, videos, and animations using a local ComfyUI instance. Programmatically constructs workflow DAGs, submits them to ComfyUI's API, and retrieves outputs. Optimized for M4 Mac with 128GB RAM — supports SDXL, SVD, Flux, and AnimateDiff at full resolution.

## Pipeline Position

```
Trend Detection → Campaign Planning → [ComfyUI Media Generator] → [Video Ad Creator] → Media Activation
                                            ↓                            ↓
                                    Product images/video           Rendered MP4 ad
                                    Scene assets (by role)         with voiceover
```

This skill generates the **visual assets** that feed into the video-ad-creator as `product.images` and `product.videos`.

## Prerequisites

ComfyUI must be running locally:
```bash
cd ~/ComfyUI && python main.py --listen 127.0.0.1 --port 8188
```

Config is stored in SQLite. Set defaults:
```javascript
import { setConfig } from './src/db.mjs';
setConfig('COMFYUI_HOST', 'http://127.0.0.1:8188');
setConfig('COMFYUI_CHECKPOINT', 'sd_xl_base_1.0.safetensors');
setConfig('COMFYUI_STEPS', '30');
setConfig('COMFYUI_CFG', '7.0');
setConfig('COMFYUI_SAMPLER', 'euler');
```

## Input Contract — `MediaGenerationRequest`

```json
{
  "type": "image | video | animation | product-assets",
  "prompt": "descriptive text prompt",
  "negativePrompt": "things to avoid",
  "style": "editorial beauty photography",
  "constraints": {
    "width": 1024,
    "height": 1024,
    "duration": "4s",
    "fps": 24,
    "frames": 25
  },
  "product": {
    "name": "Complete Lip Kit",
    "description": "Luxury lip care set with gloss, liner, and balm",
    "assetRoles": ["hero_product", "lifestyle", "ingredient"]
  },
  "options": {
    "checkpoint": "sd_xl_base_1.0.safetensors",
    "steps": 35,
    "cfg": 7.5,
    "sampler": "dpmpp_2m",
    "scheduler": "karras",
    "seed": -1,
    "batchSize": 1,
    "denoise": 0.7,
    "template": "beauty-hero-shot"
  }
}
```

## Output Contract — `MediaGenerationResult`

```json
{
  "status": "done",
  "type": "image",
  "outputs": [
    {
      "role": "hero_product",
      "filename": "instinctsai-hero_00001.png",
      "url": "http://127.0.0.1:8188/view?filename=...",
      "prompt": "the prompt used",
      "seed": 123456
    }
  ],
  "promptId": "comfyui-prompt-id",
  "workflowRecord": "data/comfyui-workflows/{id}.json"
}
```

## Execution Steps

### Step 1: Check ComfyUI Health

```javascript
import { checkHealth, getQueueStatus } from './src/comfyui.mjs';

const health = await checkHealth();
if (!health.online) {
  throw new Error('ComfyUI is not running. Start it with: cd ~/ComfyUI && python main.py');
}
const queue = await getQueueStatus();
// queue.running, queue.pending
```

### Step 2: Select Generation Strategy

Based on `request.type`:

| Type | Function | Use Case |
|------|----------|----------|
| `image` | `generateImage(params)` | Text-to-image generation |
| `variation` | `generateVariation(params)` | Image-to-image refinement |
| `video` | `generateVideo(params)` | Image-to-video via SVD |
| `animation` | `generateAnimation(params)` | Text-to-animation via AnimateDiff |
| `product-assets` | `generateProductAssets(params)` | Multi-role asset generation for campaigns |

### Step 3: Build & Execute Workflow

**Option A: Direct generation**

```javascript
import { generateImage } from './src/comfyui.mjs';

const result = await generateImage({
  prompt: 'Professional product photography of Complete Lip Kit, luxury beauty, 8k',
  negativePrompt: 'ugly, blurry, low quality, deformed, watermark',
  width: 1024,
  height: 1024,
  steps: 35,
  cfg: 7.5,
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
  filenamePrefix: 'instinctsai-hero'
});
// result.status, result.images[], result.seed, result.promptId
```

**Option B: Template-based generation**

```javascript
import { buildFromTemplate, listTemplates } from './src/comfyui-templates.mjs';
import { submitWorkflow, pollWorkflow } from './src/comfyui.mjs';

// List available templates
const templates = listTemplates();

// Build from template with variable substitution
const workflow = buildFromTemplate('beauty-hero-shot', {
  product: 'Complete Lip Kit with gloss, liner, and balm'
});

const { promptId } = await submitWorkflow(workflow);
const result = await pollWorkflow(promptId);
```

**Option C: Full product asset generation**

```javascript
import { generateProductAssets } from './src/comfyui.mjs';

const { assets } = await generateProductAssets({
  productName: 'Complete Lip Kit',
  productDescription: 'Luxury lip care set with gloss, liner, and balm',
  style: 'editorial beauty photography',
  brandAesthetic: 'luxury, clean, premium, dark background with gold accents',
  assetRoles: ['hero_product', 'lifestyle', 'ingredient', 'flatlay'],
  width: 1024,
  height: 1024
});

// assets = [
//   { role: 'hero_product', status: 'done', images: [...], prompt: '...', seed: 123 },
//   { role: 'lifestyle', status: 'done', images: [...], prompt: '...', seed: 456 },
//   ...
// ]
```

### Step 4: Generate Video from Image (optional)

```javascript
import { generateVideo } from './src/comfyui.mjs';

// Take the hero product image and animate it
const video = await generateVideo({
  inputImage: assets[0].images[0].filename,
  width: 1024,
  height: 576,
  frames: 25,
  fps: 8,
  motionBucketId: 80,
  steps: 25,
  cfg: 2.5,
  filenamePrefix: 'product-reveal'
});
// video.status, video.videos[]
```

### Step 5: Return Results to Pipeline

Package outputs for the video-ad-creator skill:

```javascript
const pipelineOutput = {
  status: 'done',
  type: request.type,
  outputs: assets.map(a => ({
    role: a.role,
    filename: a.images[0]?.filename,
    url: a.images[0]?.url,
    prompt: a.prompt,
    seed: a.seed
  })),
  // These feed directly into video-ad-creator's product.images
  imageUrls: assets.flatMap(a => a.images.map(i => i.url)),
  videoUrls: videos?.map(v => v.url) || []
};
```

## Available Templates

| Template | Type | Resolution | Description |
|----------|------|------------|-------------|
| `beauty-hero-shot` | text-to-image | 1024×1024 | Hero product shot, studio lighting |
| `beauty-lifestyle` | text-to-image | 1024×1536 | Lifestyle with model, golden hour |
| `beauty-ingredient-macro` | text-to-image | 1024×1024 | Macro ingredient close-up |
| `beauty-flatlay` | text-to-image | 1024×1024 | Overhead flat-lay arrangement |
| `product-reveal-video` | image-to-video | 1024×576 | Slow product reveal (SVD) |
| `texture-flow-video` | image-to-video | 1024×576 | Flowing texture motion (SVD) |
| `tiktok-vertical` | text-to-image | 768×1344 | Vertical format for TikTok/Reels |
| `instagram-square` | text-to-image | 1024×1024 | Square format for Instagram |

## Workflow Builders

Low-level builders for custom workflows:

| Builder | Function | Description |
|---------|----------|-------------|
| Text-to-Image | `buildTextToImage(params)` | Checkpoint → CLIP → Latent → KSampler → VAEDecode → Save |
| Image-to-Image | `buildImageToImage(params)` | LoadImage → VAEEncode → KSampler → VAEDecode → Save |
| Image-to-Video | `buildImageToVideo(params)` | LoadImage → SVD Conditioning → KSampler → VAEDecode → VideoCombine |
| AnimateDiff | `buildAnimateDiff(params)` | Checkpoint → MotionModule → KSampler → VAEDecode → VideoCombine |
| Raw | `executeRawWorkflow(graph)` | Submit any custom DAG |

## Parameter Tuning Guide (M4 128GB)

With 128GB unified memory, you can run large models efficiently:

| Parameter | Conservative | Balanced | Maximum Quality |
|-----------|-------------|----------|-----------------|
| Resolution | 512×512 | 1024×1024 | 2048×2048 |
| Steps | 20 | 30-35 | 50 |
| CFG | 5.0 | 7.0-7.5 | 10.0 |
| Batch Size | 1 | 2-4 | 8 |
| Video Frames | 16 | 25 | 48 |
| Sampler | euler | dpmpp_2m | dpmpp_2m_sde |
| Scheduler | normal | karras | karras |

### Recommended Models for M4

- **SDXL Base**: `sd_xl_base_1.0.safetensors` — general purpose, excellent quality
- **SDXL Refiner**: `sd_xl_refiner_1.0.safetensors` — detail enhancement pass
- **SVD XT 1.1**: `svd_xt_1_1.safetensors` — image-to-video, 25 frames
- **Flux**: High quality, needs more VRAM but M4 128GB handles it
- **AnimateDiff v2**: `mm_sd_v15_v2.ckpt` — text-to-animation

## Iteration Strategies

If output quality is insufficient:

1. **Adjust CFG** — too high = oversaturated, too low = unfocused
2. **Increase steps** — diminishing returns past 40
3. **Change sampler** — try `dpmpp_2m_sde` with `karras` scheduler
4. **Refine with img2img** — use `generateVariation()` with denoise 0.3-0.5
5. **Add ControlNet** — for pose/composition control (use raw workflow builder)
6. **Fix seed** — lock seed for consistent iterations, change prompt only

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Connection refused | ComfyUI not running | Start ComfyUI server |
| Model not found | Checkpoint missing | Download model to ComfyUI/models/checkpoints/ |
| Out of memory | Resolution too high | Reduce resolution or batch size |
| Invalid graph | Node mismatch | Check node class_type names |
| Timeout | Complex workflow | Increase pollWorkflow maxAttempts |

## Utility Functions

```javascript
import { checkHealth, getQueueStatus, listCheckpoints } from './src/comfyui.mjs';

// Check if ComfyUI is running
const health = await checkHealth();
// { online: true, system: {...}, devices: [...] }

// Check queue
const queue = await getQueueStatus();
// { running: 1, pending: 3 }

// List available models
const models = await listCheckpoints();
// ['sd_xl_base_1.0.safetensors', 'flux_dev.safetensors', ...]
```

## Full Pipeline Example

```javascript
import { generateProductAssets, generateVideo } from './src/comfyui.mjs';

// 1. Generate product images for all asset roles
const { assets } = await generateProductAssets({
  productName: 'Complete Lip Kit',
  productDescription: 'Luxury lip care set',
  style: 'editorial beauty photography',
  brandAesthetic: 'dark luxury, gold accents, premium',
  assetRoles: ['hero_product', 'lifestyle', 'ingredient'],
  width: 1024,
  height: 1024
});

// 2. Generate product reveal video from hero shot
const heroImage = assets.find(a => a.role === 'hero_product');
const video = await generateVideo({
  inputImage: heroImage.images[0].filename,
  frames: 25,
  fps: 8,
  motionBucketId: 80
});

// 3. Feed into video-ad-creator pipeline
const adRequest = {
  campaign: { /* from upstream */ },
  product: {
    images: assets.flatMap(a => a.images.map(i => i.url)),
    videos: video.videos.map(v => v.url)
  },
  brand: { /* from brand kit */ },
  copy: { /* from campaign planning */ }
};
// → Pass to video-ad-creator skill
```
