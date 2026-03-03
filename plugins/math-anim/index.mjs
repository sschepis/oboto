/**
 * Math Animation Plugin
 *
 * Enables the AI to produce animated mathematical explanations inline in chat
 * using a Manim-inspired declarative JSON DSL rendered via ```mathanim code fences.
 *
 * The AI can either:
 * 1. Output ```mathanim code fences directly in its response
 * 2. Use the `generate_math_animation` tool to have the LLM generate the DSL
 *
 * @module @oboto/plugin-math-anim
 */

import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

// ── Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    enabled: true,
    defaultDuration: 6,
    defaultWidth: 600,
    defaultHeight: 400,
    defaultBackground: '#0a0a1a',
};

const SETTINGS_SCHEMA = [
    {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        description: 'Enable or disable math animation rendering',
        default: true,
    },
    {
        key: 'defaultDuration',
        label: 'Default Duration (seconds)',
        type: 'number',
        description: 'Default animation duration when not specified in the DSL',
        default: 6,
        min: 1,
        max: 60,
    },
    {
        key: 'defaultWidth',
        label: 'Default Width (px)',
        type: 'number',
        description: 'Default canvas width',
        default: 600,
        min: 200,
        max: 1200,
    },
    {
        key: 'defaultHeight',
        label: 'Default Height (px)',
        type: 'number',
        description: 'Default canvas height',
        default: 400,
        min: 150,
        max: 800,
    },
    {
        key: 'defaultBackground',
        label: 'Default Background Color',
        type: 'string',
        description: 'Default background color for animations',
        default: '#0a0a1a',
    },
];

// ── DSL generation prompt ────────────────────────────────────────────────

const MATHANIM_GENERATION_PROMPT = `
You are a mathematical animation designer. Create a JSON animation specification for the following concept.

The JSON must follow this schema:
{
  "title": "string — title of the animation",
  "width": 600,
  "height": 400,
  "background": "#0a0a1a",
  "scenes": [
    {
      "id": "string — unique scene identifier",
      "duration": number — scene duration in seconds,
      "objects": [
        // Each object has a "type" field. Available types:
        // "axes" — coordinate axes with xRange, yRange, xLabel, yLabel, color, showGrid
        // "graph" — function graph with axesRef, fn (math expression like "x^2"), xRange, color, strokeWidth
        // "parametric" — parametric curve with axesRef, fnX, fnY, tRange, color
        // "vector" — arrow with from, to, color, label, axesRef
        // "dot" — point with position, radius, color, label, axesRef
        // "line" — line segment with from, to, color, strokeWidth, dashed
        // "rect" — rectangle with position, width, height, color, fill, label
        // "circle" — circle with center, radius, color, fill
        // "polygon" — polygon with points array, color, fill, axesRef
        // "latex" — LaTeX expression with expression, position, fontSize, color
        // "text" — plain text with content, position, fontSize, color, align
        // "brace" — brace annotation with from, to, label, direction, color
        // "area" — shaded area under curve with graphRef, xRange, fill, axesRef
        // "numberLine" — number line with range, position, length, color, highlights
      ],
      "animations": [
        // Each animation has: type, target (object id), startTime, duration, easing
        // Available types: fadeIn, fadeOut, create, write, traceGraph, growArrow,
        //   moveTo (position), scale (factor), rotate (angle), indicate (color),
        //   circumscribe (shape), traceDot (graphRef, tRange), colorChange (color),
        //   shiftIn (direction), showCreation, uncreate
        // Easing: linear, easeIn, easeOut, easeInOut, easeInQuad, easeOutQuad, etc.
      ]
    }
  ]
}

Rules:
1. All objects need a unique "id" field
2. Objects using coordinate systems should reference axes via "axesRef"
3. Math expressions in "fn" use standard notation: x^2, sin(x), cos(x), sqrt(x), log(x), exp(x), pi, e
4. Stagger animations with startTime so they play sequentially
5. Keep scenes 3-8 seconds each
6. Use colors that are visible on dark backgrounds

Return ONLY valid JSON. No explanations, no markdown wrapping.
`;

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    const { pluginSettings } = await registerSettingsHandlers(
        api, 'math-anim', DEFAULT_SETTINGS, SETTINGS_SCHEMA
    );

    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'generate_math_animation',
        description: 'Generate an animated mathematical visualization. Produces a mathanim code block that renders as an interactive animation inline in the chat. Use this to explain mathematical concepts visually with animated graphs, geometric proofs, vector operations, calculus concepts, and transformations.',
        parameters: {
            type: 'object',
            properties: {
                description: {
                    type: 'string',
                    description: 'Description of the mathematical concept to animate (e.g., "Show how the derivative of x^2 is 2x by animating the tangent line", "Demonstrate the Pythagorean theorem with animated squares on triangle sides")'
                },
                complexity: {
                    type: 'string',
                    enum: ['simple', 'moderate', 'detailed'],
                    description: 'How detailed the animation should be. Simple = 1 scene, few objects. Detailed = multiple scenes, many objects and animations.'
                }
            },
            required: ['description']
        },
        handler: async ({ description, complexity = 'moderate' }) => {
            if (!pluginSettings.enabled) {
                return 'Math Animation plugin is disabled.';
            }

            const prompt = `${MATHANIM_GENERATION_PROMPT}

Complexity level: ${complexity}
${complexity === 'simple' ? '- Use 1 scene, 3-5 objects, 3-5 animations' : ''}
${complexity === 'moderate' ? '- Use 1-2 scenes, 5-8 objects, 5-10 animations' : ''}
${complexity === 'detailed' ? '- Use 2-3 scenes, 8-15 objects, 10-20 animations' : ''}

Default canvas: ${pluginSettings.defaultWidth}x${pluginSettings.defaultHeight}, background: "${pluginSettings.defaultBackground}"

Animate this concept: ${description}`;

            try {
                const response = await api.ai.ask(prompt);
                let code = typeof response === 'object' && response.text ? response.text : response;
                // Strip any markdown wrapping the LLM might add
                code = code.replace(/```json\s*/gi, '').replace(/```mathanim\s*/gi, '').replace(/```/g, '').trim();

                // Validate it's parseable JSON with the expected structure
                const parsed = JSON.parse(code);
                if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
                    return 'Error: generated animation is missing required "scenes" array';
                }
                for (const scene of parsed.scenes) {
                    if (!Array.isArray(scene.objects) || !Array.isArray(scene.animations)) {
                        return 'Error: each scene must have "objects" and "animations" arrays';
                    }
                }

                // Re-serialize to guarantee canonical JSON (no trailing commas,
                // duplicate keys, or other edge cases the LLM might produce)
                const canonical = JSON.stringify(parsed);

                return {
                    __directMarkdown: `\`\`\`mathanim\n${canonical}\n\`\`\``
                };
            } catch (e) {
                return `Error generating math animation: ${e.message}`;
            }
        }
    });
}

export async function deactivate(_api) {
    // Cleanup handled automatically by PluginAPI._cleanup()
}
