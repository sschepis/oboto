/**
 * Oboto Image Plugin
 *
 * Provides image generation (DALL-E 3), image variations (DALL-E 2),
 * image manipulation (sharp), and image metadata inspection.
 * Extracted from src/execution/handlers/image-handlers.mjs and
 * src/tools/definitions/image-tools.mjs.
 *
 * @module @oboto/plugin-image
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// ── Helpers ──────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Escape XML special characters to prevent SVG injection.
 * @param {string} s
 * @returns {string}
 */
function escapeXml(s) {
    if (!s) return '';
    return s.replace(/[<>&"']/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;'
    }[c]));
}

/**
 * Ensure a resolved path stays within the workspace root.
 * Prevents path traversal attacks (e.g. ../../etc/passwd).
 * @param {string} resolved — absolute resolved path
 * @param {string} root — workspace root
 * @throws {Error} if path escapes root
 */
function assertWithinWorkspace(resolved, root) {
    const normalizedRoot = path.resolve(root);
    const normalizedPath = path.resolve(resolved);
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(normalizedRoot + path.sep)) {
        throw new Error(`Path traversal not allowed: path must be within workspace`);
    }
}

// ── Tool Handlers ────────────────────────────────────────────────────────

async function handleGenerateImage(apiKey, workspaceRoot, generatedImagesDir, args) {
    const { prompt, size = '1024x1024', quality = 'standard', style = 'vivid', filename_prefix } = args;

    if (!apiKey) {
        return 'Error: OpenAI API key is not configured. Set OPENAI_API_KEY or configure in plugin settings.';
    }

    try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt,
                n: 1,
                size,
                quality,
                style,
                response_format: 'url'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const imageUrl = data.data[0].url;

        // Download the image
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Generate filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safePrompt = prompt.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = filename_prefix
            ? `${filename_prefix}.png`
            : `img_${timestamp}_${safePrompt}.png`;

        ensureDir(generatedImagesDir);
        const filePath = path.join(generatedImagesDir, filename);
        const relativePath = path.relative(workspaceRoot, filePath);

        fs.writeFileSync(filePath, buffer);

        return JSON.stringify({
            message: 'Image generated and saved successfully.',
            local_path: relativePath,
            original_prompt: prompt
        }, null, 2);

    } catch (error) {
        return `Error generating image: ${error.message}`;
    }
}

async function handleCreateImageVariation(apiKey, workspaceRoot, generatedImagesDir, args) {
    const { input_path, n = 1, size = '1024x1024', filename_prefix } = args;

    if (!apiKey) {
        return 'Error: OpenAI API key is not configured. Set OPENAI_API_KEY or configure in plugin settings.';
    }

    try {
        const absoluteInputPath = path.resolve(workspaceRoot, input_path);
        assertWithinWorkspace(absoluteInputPath, workspaceRoot);
        if (!fs.existsSync(absoluteInputPath)) {
            throw new Error(`Input file not found: ${input_path}`);
        }

        // Read and pre-process to meet DALL-E requirements (PNG, square, <4MB)
        const buffer = fs.readFileSync(absoluteInputPath);
        let processedBuffer = buffer;

        const image = sharp(buffer);
        const metadata = await image.metadata();

        if (metadata.format !== 'png' || metadata.width !== metadata.height || metadata.size > 4 * 1024 * 1024) {
            const cropSize = Math.min(metadata.width, metadata.height);
            processedBuffer = await image
                .resize(cropSize, cropSize, { fit: 'cover' })
                .png()
                .toBuffer();
        }

        const formData = new FormData();
        formData.append('image', new Blob([processedBuffer], { type: 'image/png' }), 'image.png');
        formData.append('n', n.toString());
        formData.append('size', size);
        formData.append('model', 'dall-e-2');

        const response = await fetch('https://api.openai.com/v1/images/variations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const results = [];

        ensureDir(generatedImagesDir);

        for (let i = 0; i < data.data.length; i++) {
            const imageUrl = data.data[i].url;
            const imageResponse = await fetch(imageUrl);
            const arrayBuffer = await imageResponse.arrayBuffer();
            const dlBuffer = Buffer.from(arrayBuffer);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = filename_prefix
                ? `${filename_prefix}_var_${i + 1}.png`
                : `var_${timestamp}_${i + 1}.png`;

            const filePath = path.join(generatedImagesDir, filename);
            const relativePath = path.relative(workspaceRoot, filePath);

            fs.writeFileSync(filePath, dlBuffer);

            results.push({ local_path: relativePath });
        }

        return JSON.stringify({
            message: 'Image variations created successfully.',
            variations: results
        }, null, 2);

    } catch (error) {
        return `Error generating variation: ${error.message}`;
    }
}

async function handleManipulateImage(workspaceRoot, args) {
    const { input_path, output_path, operations } = args;

    try {
        const absoluteInputPath = path.resolve(workspaceRoot, input_path);
        assertWithinWorkspace(absoluteInputPath, workspaceRoot);
        if (!fs.existsSync(absoluteInputPath)) {
            throw new Error(`Input file not found: ${input_path}`);
        }

        let pipeline = sharp(absoluteInputPath);
        const metadata = await pipeline.metadata();

        for (const op of operations) {
            switch (op.type) {
                case 'resize':
                    pipeline = pipeline.resize({
                        width: op.width,
                        height: op.height,
                        fit: op.fit || 'cover'
                    });
                    break;
                case 'crop':
                    pipeline = pipeline.extract({
                        left: op.region_left,
                        top: op.region_top,
                        width: op.region_width,
                        height: op.region_height
                    });
                    break;
                case 'rotate':
                    pipeline = pipeline.rotate(op.angle);
                    break;
                case 'flip':
                    pipeline = pipeline.flip();
                    break;
                case 'flop':
                    pipeline = pipeline.flop();
                    break;
                case 'grayscale':
                    pipeline = pipeline.grayscale();
                    break;
                case 'blur':
                    pipeline = pipeline.blur(op.sigma || 0.3);
                    break;
                case 'sharpen':
                    pipeline = pipeline.sharpen();
                    break;
                case 'composite':
                    if (op.overlay_path) {
                        const overlayAbsPath = path.resolve(workspaceRoot, op.overlay_path);
                        assertWithinWorkspace(overlayAbsPath, workspaceRoot);
                        if (fs.existsSync(overlayAbsPath)) {
                            pipeline = pipeline.composite([{
                                input: overlayAbsPath,
                                gravity: op.gravity || 'southeast',
                                top: op.top,
                                left: op.left
                            }]);
                        } else {
                            return `Error: Overlay image not found: ${op.overlay_path}`;
                        }
                    }
                    break;
                case 'text_overlay': {
                    const width = metadata.width || 1024;
                    const height = metadata.height || 1024;
                    const fontSize = op.font_size || 48;
                    const color = escapeXml(op.color || 'white');
                    const safeText = escapeXml(op.text || '');

                    const svgText = `
                    <svg width="${width}" height="${height}">
                      <style>
                        .text { fill: ${color}; font-size: ${fontSize}px; font-weight: bold; font-family: sans-serif; text-anchor: middle; dominant-baseline: middle; }
                      </style>
                      <text x="50%" y="50%" class="text">${safeText}</text>
                    </svg>`;

                    pipeline = pipeline.composite([{
                        input: Buffer.from(svgText),
                        gravity: op.gravity || 'center'
                    }]);
                    break;
                }
                case 'convert':
                    if (op.format) {
                        pipeline = pipeline.toFormat(op.format, { quality: op.quality || 80 });
                    }
                    break;
            }
        }

        let finalOutputPath = output_path;
        if (!finalOutputPath) {
            const parsed = path.parse(input_path);
            const convertOp = operations.findLast(o => o.type === 'convert');
            const ext = convertOp ? `.${convertOp.format}` : parsed.ext;
            finalOutputPath = path.join(parsed.dir, `${parsed.name}_edited${ext}`);
        }

        const absoluteOutputPath = path.resolve(workspaceRoot, finalOutputPath);
        assertWithinWorkspace(absoluteOutputPath, workspaceRoot);
        ensureDir(path.dirname(absoluteOutputPath));

        const info = await pipeline.toFile(absoluteOutputPath);

        return JSON.stringify({
            message: 'Image manipulation successful.',
            output_path: finalOutputPath,
            details: info
        }, null, 2);

    } catch (error) {
        return `Error manipulating image: ${error.message}`;
    }
}

async function handleGetImageInfo(workspaceRoot, args) {
    const { path: imagePath } = args;

    try {
        const absolutePath = path.resolve(workspaceRoot, imagePath);
        assertWithinWorkspace(absolutePath, workspaceRoot);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Image file not found: ${imagePath}`);
        }

        const metadata = await sharp(absolutePath).metadata();

        return JSON.stringify({
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
            space: metadata.space,
            channels: metadata.channels,
            density: metadata.density,
            hasAlpha: metadata.hasAlpha,
            size: metadata.size
        }, null, 2);

    } catch (error) {
        return `Error getting image info: ${error.message}`;
    }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const workspaceRoot = api.workingDir || process.cwd();
    const generatedImagesDir = path.join(workspaceRoot, 'public', 'generated-images');

    // Resolve API key: plugin settings first, then environment variable
    const getApiKey = async () =>
        (await api.settings.get('openaiApiKey')) || process.env.OPENAI_API_KEY || '';

    // ── generate_image ───────────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        name: 'generate_image',
        description: 'Generate an image using AI (DALL-E 3). Returns a local URL to the generated image.',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'A detailed text description of the desired image.'
                },
                size: {
                    type: 'string',
                    enum: ['1024x1024'],
                    description: 'The size of the generated image. Default is 1024x1024.',
                    default: '1024x1024'
                },
                quality: {
                    type: 'string',
                    enum: ['standard', 'hd'],
                    description: 'The quality of the image. HD creates more detailed images but may take longer.',
                    default: 'standard'
                },
                style: {
                    type: 'string',
                    enum: ['vivid', 'natural'],
                    description: 'The style of the generated image. Vivid leans towards hyper-realism; natural produces more natural-looking images.',
                    default: 'vivid'
                },
                filename_prefix: {
                    type: 'string',
                    description: 'Optional prefix for the saved filename. If not provided, a timestamped name will be used.'
                }
            },
            required: ['prompt']
        },
        handler: async (args) => handleGenerateImage(await getApiKey(), workspaceRoot, generatedImagesDir, args)
    });

    // ── create_image_variation ────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        name: 'create_image_variation',
        description: 'Create a variation of an existing image using AI (DALL-E 2).',
        parameters: {
            type: 'object',
            properties: {
                input_path: {
                    type: 'string',
                    description: 'Path to the input image file (relative to workspace). Must be a valid PNG (less than 4MB).'
                },
                n: {
                    type: 'number',
                    description: 'Number of variations to generate (1-10).',
                    default: 1
                },
                size: {
                    type: 'string',
                    enum: ['256x256', '512x512', '1024x1024'],
                    description: 'The size of the generated images. Default is 1024x1024.',
                    default: '1024x1024'
                },
                filename_prefix: {
                    type: 'string',
                    description: 'Optional prefix for the saved filename.'
                }
            },
            required: ['input_path']
        },
        handler: async (args) => handleCreateImageVariation(await getApiKey(), workspaceRoot, generatedImagesDir, args)
    });

    // ── manipulate_image ─────────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        name: 'manipulate_image',
        description: 'Manipulate an existing image using various operations (resize, crop, text overlay, etc.).',
        parameters: {
            type: 'object',
            properties: {
                input_path: {
                    type: 'string',
                    description: 'Path to the input image file (relative to workspace).'
                },
                output_path: {
                    type: 'string',
                    description: 'Path where the manipulated image should be saved (relative to workspace). If not provided, a new file based on input name is created.'
                },
                operations: {
                    type: 'array',
                    description: 'List of operations to perform in order.',
                    items: {
                        type: 'object',
                        properties: {
                            type: {
                                type: 'string',
                                enum: [
                                    'resize', 'rotate', 'flip', 'flop', 'grayscale', 'blur', 'sharpen',
                                    'composite', 'crop', 'text_overlay', 'convert'
                                ],
                                description: 'The type of operation to perform.'
                            },
                            width: { type: 'number', description: 'Width for resize' },
                            height: { type: 'number', description: 'Height for resize' },
                            fit: { type: 'string', enum: ['cover', 'contain', 'fill', 'inside', 'outside'], description: 'Fit strategy for resize' },
                            angle: { type: 'number', description: 'Angle for rotation (degrees)' },
                            sigma: { type: 'number', description: 'Sigma for blur (0.3 - 1000)' },
                            overlay_path: { type: 'string', description: 'Path to image to overlay (for composite)' },
                            gravity: { type: 'string', description: 'Gravity for overlay (e.g., "southeast")' },
                            top: { type: 'number', description: 'Top offset for overlay' },
                            left: { type: 'number', description: 'Left offset for overlay' },
                            region_left: { type: 'number', description: 'Left offset for crop' },
                            region_top: { type: 'number', description: 'Top offset for crop' },
                            region_width: { type: 'number', description: 'Width for crop' },
                            region_height: { type: 'number', description: 'Height for crop' },
                            text: { type: 'string', description: 'Text to overlay' },
                            font_size: { type: 'number', description: 'Font size (pixels)' },
                            color: { type: 'string', description: 'Text color (e.g., "white", "#ff0000")' },
                            background: { type: 'string', description: 'Background color for text box' },
                            format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'avif', 'tiff'], description: 'Output format' },
                            quality: { type: 'number', description: 'Quality (1-100)' }
                        },
                        required: ['type']
                    }
                }
            },
            required: ['input_path', 'operations']
        },
        handler: (args) => handleManipulateImage(workspaceRoot, args)
    });

    // ── get_image_info ────────────────────────────────────────────────────
    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'get_image_info',
        description: 'Get metadata about an image (dimensions, format, etc.).',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the image file.'
                }
            },
            required: ['path']
        },
        handler: (args) => handleGetImageInfo(workspaceRoot, args)
    });
}

export async function deactivate(_api) {
    // Cleanup handled automatically by PluginAPI._cleanup()
}
