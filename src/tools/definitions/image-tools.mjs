export const IMAGE_TOOLS = [
    {
        type: 'function',
        function: {
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
                        description: 'The style of the generated image. Vivid causes the model to lean towards hyper-realism and dramatic lighting. Natural causes the model to produce more natural, less hyper-real looking images.',
                        default: 'vivid'
                    },
                    filename_prefix: {
                        type: 'string',
                        description: 'Optional prefix for the saved filename. If not provided, a timestamped name will be used.'
                    }
                },
                required: ['prompt']
            }
        }
    },
    {
        type: 'function',
        function: {
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
            }
        }
    },
    {
        type: 'function',
        function: {
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
                        description: 'Path where the manipulated image should be saved (relative to workspace). If not provided, it overwrites or creates a new file based on input name.'
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
                                // Resize options
                                width: { type: 'number', description: 'Width for resize' },
                                height: { type: 'number', description: 'Height for resize' },
                                fit: { type: 'string', enum: ['cover', 'contain', 'fill', 'inside', 'outside'], description: 'Fit strategy for resize' },
                                // Rotate options
                                angle: { type: 'number', description: 'Angle for rotation (degrees)' },
                                // Blur options
                                sigma: { type: 'number', description: 'Sigma for blur (0.3 - 1000)' },
                                // Composite options
                                overlay_path: { type: 'string', description: 'Path to image to overlay (for composite)' },
                                gravity: { type: 'string', description: 'Gravity for overlay (e.g., "southeast")' },
                                top: { type: 'number', description: 'Top offset for overlay' },
                                left: { type: 'number', description: 'Left offset for overlay' },
                                // Crop options
                                region_left: { type: 'number', description: 'Left offset for crop' },
                                region_top: { type: 'number', description: 'Top offset for crop' },
                                region_width: { type: 'number', description: 'Width for crop' },
                                region_height: { type: 'number', description: 'Height for crop' },
                                // Text Overlay options
                                text: { type: 'string', description: 'Text to overlay' },
                                font_size: { type: 'number', description: 'Font size (pixels)' },
                                color: { type: 'string', description: 'Text color (e.g., "white", "#ff0000")' },
                                background: { type: 'string', description: 'Background color for text box' },
                                // Convert options
                                format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'avif', 'tiff'], description: 'Output format' },
                                quality: { type: 'number', description: 'Quality (1-100)' }
                            },
                            required: ['type']
                        }
                    }
                },
                required: ['input_path', 'operations']
            }
        }
    },
    {
        type: 'function',
        function: {
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
            }
        }
    }
];
