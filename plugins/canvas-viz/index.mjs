import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

const DEFAULT_SETTINGS = {
  enabled: true,
  autoCapture: true,
  observationLabelLength: 20,
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable canvas visualization', default: true },
  { key: 'autoCapture', label: 'Auto-Capture Observations', type: 'boolean', description: 'Automatically add DSN observations as graph nodes', default: true },
  { key: 'observationLabelLength', label: 'Observation Label Length', type: 'number', description: 'Max characters for auto-generated observation node labels', default: 20 },
];

class CanvasService {
  constructor(api, settings) {
    this.api = api;
    this.settings = settings;
    this.nodes = new Map();
    this.edges = new Map();
  }

  register() {
    this.api.ws.register('canvas:get-graph', async () => this.getGraph());
    this.api.ws.register('canvas:add-node', async (node) => this.addNode(node));
    
    if (this.api.events && this.api.events.onSystem) {
        this.api.events.onSystem('dsn:observation', (obs) => {
            try {
                if (!this.settings.autoCapture) return;
                if (obs && obs.content) {
                    const labelLen = this.settings.observationLabelLength || 20;
                    const node = { id: `obs-${Date.now()}`, label: obs.content.substring(0, labelLen) };
                    this.addNode(node);
                }
            } catch (e) {
                console.error('Canvas Viz: Failed to add observation node', e);
            }
        });
    }
  }

  getGraph() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values())
    };
  }

  addNode(node) {
    if (!node.id) node.id = Math.random().toString(36).substr(2, 9);
    this.nodes.set(node.id, node);
    this.api.ws.broadcast('canvas:node-added', node);
    return node;
  }
}

export async function activate(api) {
  console.log('[Canvas Viz] Activating...');

  let service;

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'canvas-viz', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
    () => { if (service) Object.assign(service.settings, pluginSettings); }
  );

  service = new CanvasService(api, pluginSettings);
  service.register();
  
  api.tools.register({
    name: 'generate_canvas_viz',
    description: 'Generates an interactive canvas visualization based on a description.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description of the visualization to generate'
        }
      },
      required: ['description']
    },
    handler: async ({ description }) => {
      if (!pluginSettings.enabled) {
        return 'Canvas Viz plugin is disabled.';
      }

      const prompt = `
      Create a JavaScript class that extends 'CanvasVisualization' to render: ${description}.
      
      The base class is defined as:
      class CanvasVisualization {
        constructor(canvasId) {
           this.canvas = document.getElementById(canvasId);
           this.ctx = this.canvas.getContext('2d');
           this.width = this.canvas.width;
           this.height = this.canvas.height;
        }
        start() { ... } // starts animation loop
        stop() { ... } // stops animation loop
        animate() { ... } // calls update() then draw()
        update() {} // Override this for logic
        draw() {} // Override this for rendering
      }
      
      Your code must:
      1. Define a class that extends CanvasVisualization.
      2. Override update() and/or draw() methods.
      3. Instantiate your class with 'canvas' as the ID.
      4. Call .start() on the instance.
      
      Example:
      class MyViz extends CanvasVisualization {
         draw() {
           this.ctx.fillStyle = 'red';
           this.ctx.fillRect(0, 0, 100, 100);
         }
      }
      new MyViz('canvas').start();
      
      Return ONLY the JavaScript code. Do not wrap in markdown blocks.
      `;

      try {
          // Use api.ai.ask instead of context.ai.complete
          const response = await api.ai.ask(prompt);
          let code = response;
          if (typeof response === 'object' && response.text) {
              code = response.text;
          }
          code = code.replace(/```javascript/gi, '').replace(/```/g, '').trim();
          
          return {
            __directMarkdown: `\`\`\`canvasviz\n${code}\n\`\`\``
          };
      } catch (e) {
          return `Error generating visualization: ${e.message}`;
      }
    }
  });

  console.log('[Canvas Viz] Ready');
}

export function deactivate(api) {
  console.log('[Canvas Viz] Deactivated');
}
