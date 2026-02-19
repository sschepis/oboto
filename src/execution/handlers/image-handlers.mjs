import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { config } from '../../config.mjs';
import sharp from 'sharp';

export class ImageHandlers {
    constructor(workspaceRoot, workspaceContentServer) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        this.workspaceContentServer = workspaceContentServer;
        this.generatedImagesDir = path.join(this.workspaceRoot, 'public', 'generated-images');
        
        // Ensure directory exists
        if (!fs.existsSync(this.generatedImagesDir)) {
            fs.mkdirSync(this.generatedImagesDir, { recursive: true });
        }
    }

    async generateImage(args) {
        const { prompt, size = '1024x1024', quality = 'standard', style = 'vivid', filename_prefix } = args;

        const apiKey = config.keys.openai;
        if (!apiKey) {
            throw new Error('OpenAI API key is missing. Please configure OPENAI_API_KEY in your environment.');
        }

        consoleStyler.log('working', `🎨 Generating image: "${prompt}"`);
        consoleStyler.log('working', `   Size: ${size}, Quality: ${quality}, Style: ${style}`, { indent: true });

        try {
            const response = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'dall-e-3',
                    prompt: prompt,
                    n: 1,
                    size: size,
                    quality: quality,
                    style: style,
                    response_format: 'url' // Request URL, we'll download it
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json();
            const imageUrl = data.data[0].url;

            consoleStyler.log('tools', `✓ Image generated successfully. Downloading...`);

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
            
            const filePath = path.join(this.generatedImagesDir, filename);
            const relativePath = path.relative(this.workspaceRoot, filePath);
            
            fs.writeFileSync(filePath, buffer);

            consoleStyler.log('tools', `✓ Image saved to: ${relativePath}`);

            // Determine URL based on workspace content server port
            const port = this.workspaceContentServer ? this.workspaceContentServer.getPort() : null;
            const baseUrl = port ? `http://localhost:${port}` : '';
            
            let urlPath = `/images/${filename}`;
            if (this.workspaceContentServer && typeof this.workspaceContentServer.resolveImagePath === 'function') {
                urlPath = this.workspaceContentServer.resolveImagePath(filename);
            }

            return JSON.stringify({
                message: 'Image generated and saved successfully.',
                local_path: relativePath,
                url: `${baseUrl}${urlPath}`,
                original_prompt: prompt
            }, null, 2);

        } catch (error) {
            consoleStyler.log('error', `Image generation failed: ${error.message}`, { box: true });
            return `Error generating image: ${error.message}`;
        }
    }

    async createImageVariation(args) {
        const { input_path, n = 1, size = '1024x1024', filename_prefix } = args;

        const apiKey = config.keys.openai;
        if (!apiKey) {
            throw new Error('OpenAI API key is missing. Please configure OPENAI_API_KEY in your environment.');
        }

        consoleStyler.log('working', `🎨 Creating image variation from: ${input_path}`);

        try {
            const absoluteInputPath = path.resolve(this.workspaceRoot, input_path);
            if (!fs.existsSync(absoluteInputPath)) {
                throw new Error(`Input file not found: ${input_path}`);
            }

            // Read file into Blob/File for FormData
            // OpenAI requires a valid PNG, less than 4MB, and square aspect ratio
            // We'll use sharp to ensure it meets requirements before uploading
            const buffer = fs.readFileSync(absoluteInputPath);
            let processedBuffer = buffer;

            // Pre-process with sharp to ensure PNG and max size
            const image = sharp(buffer);
            const metadata = await image.metadata();
            
            if (metadata.format !== 'png' || metadata.width !== metadata.height || metadata.size > 4 * 1024 * 1024) {
                 consoleStyler.log('working', `   Pre-processing image to meet DALL-E requirements (PNG, Square, <4MB)...`, { indent: true });
                 const size = Math.min(metadata.width, metadata.height);
                 processedBuffer = await image
                    .resize(size, size, { fit: 'cover' })
                    .png() // Ensure PNG
                    .toBuffer();
            }

            const formData = new FormData();
            formData.append('image', new Blob([processedBuffer], { type: 'image/png' }), 'image.png');
            formData.append('n', n.toString());
            formData.append('size', size);
            formData.append('model', 'dall-e-2'); // Variations use DALL-E 2

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

            consoleStyler.log('tools', `✓ Variations generated successfully. Downloading...`);

            const port = this.workspaceContentServer ? this.workspaceContentServer.getPort() : null;
            const baseUrl = port ? `http://localhost:${port}` : '';

            for (let i = 0; i < data.data.length; i++) {
                const imageUrl = data.data[i].url;
                const imageResponse = await fetch(imageUrl);
                const arrayBuffer = await imageResponse.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = filename_prefix 
                    ? `${filename_prefix}_var_${i+1}.png` 
                    : `var_${timestamp}_${i+1}.png`;
                
                const filePath = path.join(this.generatedImagesDir, filename);
                const relativePath = path.relative(this.workspaceRoot, filePath);
                
                fs.writeFileSync(filePath, buffer);

                let urlPath = `/images/${filename}`;
                if (this.workspaceContentServer && typeof this.workspaceContentServer.resolveImagePath === 'function') {
                    urlPath = this.workspaceContentServer.resolveImagePath(filename);
                }

                results.push({
                    local_path: relativePath,
                    url: `${baseUrl}${urlPath}`
                });
            }

            consoleStyler.log('tools', `✓ Saved ${results.length} variations.`);

            return JSON.stringify({
                message: 'Image variations created successfully.',
                variations: results
            }, null, 2);

        } catch (error) {
            consoleStyler.log('error', `Variation generation failed: ${error.message}`, { box: true });
            return `Error generating variation: ${error.message}`;
        }
    }

    async manipulateImage(args) {
        const { input_path, output_path, operations } = args;

        consoleStyler.log('working', `🖼️ Manipulating image: ${input_path}`);

        try {
            const absoluteInputPath = path.resolve(this.workspaceRoot, input_path);
            
            if (!fs.existsSync(absoluteInputPath)) {
                throw new Error(`Input file not found: ${input_path}`);
            }

            let pipeline = sharp(absoluteInputPath);
            // Must retrieve metadata periodically if dimensions change
            let metadata = await pipeline.metadata();

            for (const op of operations) {
                consoleStyler.log('working', `   Applying: ${op.type}`, { indent: true });
                
                switch (op.type) {
                    case 'resize':
                        pipeline = pipeline.resize({
                            width: op.width,
                            height: op.height,
                            fit: op.fit || 'cover'
                        });
                        // Update metadata after resize (approximate or re-read?)
                        // Sharp pipelines are lazy, so metadata won't update until execution.
                        // However, for subsequent operations like text overlay, we might need new dimensions.
                        // For simplicity, we assume text overlay provides explicit coords or generic gravity.
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
                            const overlayAbsPath = path.resolve(this.workspaceRoot, op.overlay_path);
                            if (fs.existsSync(overlayAbsPath)) {
                                pipeline = pipeline.composite([{
                                    input: overlayAbsPath,
                                    gravity: op.gravity || 'southeast',
                                    top: op.top,
                                    left: op.left
                                }]);
                            } else {
                                consoleStyler.log('warning', `Overlay image not found: ${op.overlay_path}`);
                            }
                        }
                        break;
                    case 'text_overlay':
                        const width = metadata.width || 1024;
                        const height = metadata.height || 1024;
                        const fontSize = op.font_size || 48;
                        const color = op.color || 'white';
                        const background = op.background ? `fill: ${op.background}; bg-opacity: 0.5;` : ''; // simplified
                        
                        // Construct SVG
                        // Note: complex text layout in SVG is hard. This is basic.
                        const svgText = `
                        <svg width="${width}" height="${height}">
                          <style>
                            .text { fill: ${color}; font-size: ${fontSize}px; font-weight: bold; font-family: sans-serif; text-anchor: middle; dominant-baseline: middle; }
                          </style>
                          <text x="50%" y="50%" class="text">${op.text}</text>
                        </svg>
                        `;
                        // Gravity handling for text is tricky with SVG unless we position the text element specifically.
                        // Better to let Sharp handle gravity of the SVG overlay.
                        // But SVG needs to be full size to center? Or minimal size?
                        // Let's create an SVG that matches image size and centers text, then user can use gravity to position it?
                        // No, simpler: create SVG of the text size and composite it.
                        // But calculating text width in Node is hard without canvas.
                        // Fallback: Full size SVG with centered text, composited over image.
                        
                        pipeline = pipeline.composite([{
                            input: Buffer.from(svgText),
                            gravity: op.gravity || 'center'
                        }]);
                        break;
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
                // Determine extension based on convert op or original
                // Loop ops to find last convert?
                const convertOp = operations.findLast(o => o.type === 'convert');
                const ext = convertOp ? `.${convertOp.format}` : parsed.ext;
                finalOutputPath = path.join(parsed.dir, `${parsed.name}_edited${ext}`);
            }

            const absoluteOutputPath = path.resolve(this.workspaceRoot, finalOutputPath);
            
            // Ensure output directory exists
            const outputDir = path.dirname(absoluteOutputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const info = await pipeline.toFile(absoluteOutputPath);

            consoleStyler.log('tools', `✓ Image manipulation completed. Saved to: ${finalOutputPath}`);

            return JSON.stringify({
                message: 'Image manipulation successful.',
                output_path: finalOutputPath,
                details: info
            }, null, 2);

        } catch (error) {
            consoleStyler.log('error', `Image manipulation failed: ${error.message}`, { box: true });
            return `Error manipulating image: ${error.message}`;
        }
    }

    async getImageInfo(args) {
        const { path: imagePath } = args;

        try {
            const absolutePath = path.resolve(this.workspaceRoot, imagePath);
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
            consoleStyler.log('error', `Failed to get image info: ${error.message}`);
            return `Error getting image info: ${error.message}`;
        }
    }
}
