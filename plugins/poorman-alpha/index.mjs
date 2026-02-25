import { computeAsync, computationalTool, getCacheStats, clearCache } from './native.mjs';
import { callSympy, shutdown as shutdownSympy, getCacheStats as getSympyCacheStats } from './sympy-bridge.mjs';

const DEFAULT_SETTINGS = {
  pythonPath: 'python3',
  sympyTimeout: 30000,
  nerdamerTimeout: 10000,
  cacheEnabled: true,
  defaultFormat: 'text',
  persistentPython: true,
};

// NOTE: Plugin state is stored on `api._pluginInstance` rather than in a module-level
// variable. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up state via `api._pluginInstance`, and the new module
// starts fresh.

export async function activate(api) {
  console.log(`[poorman-alpha] Activating plugin ${api.id}`);

  let settings = { ...DEFAULT_SETTINGS };

  try {
    const stored = await api.settings.get('settings');
    if (stored && typeof stored === 'object') {
      settings = { ...DEFAULT_SETTINGS, ...stored };
    }
  } catch (_e) {
    // Use defaults
  }

  // Store mutable state on api._pluginInstance
  api._pluginInstance = { settings };

  const computeTool = {
    name: 'compute',
    description:
      'Evaluate math expressions: unit conversions (e.g. "5 meters to feet"), ' +
      'symbolic algebra (e.g. "solve(x^2+2x=8,x)"), arithmetic, expand, factor, simplify. ' +
      'Supports format options: "text" (default), "latex", "all".',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'A math expression to evaluate. Supports unit conversion ("5 meters to feet"), ' +
            'algebra ("solve(x^2+2x=8,x)"), expand, factor, simplify, and arithmetic.'
        },
        format: {
          type: 'string',
          description: 'Output format: "text" (default), "latex", or "all" (both text and LaTeX).',
          enum: ['text', 'latex', 'all']
        }
      },
      required: ['expression']
    },
    handler: async (args) => {
      const format = args.format || settings.defaultFormat;
      const result = await computeAsync(args.expression, {
        format,
        cache: settings.cacheEnabled,
        timeout: settings.nerdamerTimeout,
      });
      return result;
    }
  };

  api.tools.register(computeTool);

  const sympyTool = {
    name: 'sympy_compute',
    description:
      'Evaluate advanced symbolic math via SymPy (Python). ' +
      'Supports integrals, derivatives, differential equations, series expansions, and more. ' +
      'Options: format ("text", "latex", "all"), steps (true/false for step-by-step), ' +
      'plot (true/false for graph generation). Requires python3 with sympy installed.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'A SymPy expression (e.g. "integrate(x**2, x)", "diff(sin(x), x)", "solve(x**2 - 4, x)").'
        },
        format: {
          type: 'string',
          description: 'Output format: "text" (default), "latex", or "all".',
          enum: ['text', 'latex', 'all']
        },
        steps: {
          type: 'boolean',
          description: 'If true, include step-by-step solution breakdown.'
        },
        plot: {
          type: 'boolean',
          description: 'If true, generate a plot of the expression as base64 PNG.'
        }
      },
      required: ['expression']
    },
    handler: async (args) => {
      return await callSympy(args.expression, {
        format: args.format || settings.defaultFormat,
        steps: args.steps || false,
        plot: args.plot || false,
        cache: settings.cacheEnabled,
        pythonPath: settings.pythonPath,
        timeout: settings.sympyTimeout,
        persistent: settings.persistentPython,
      });
    }
  };

  api.tools.register(sympyTool);

  const matrixTool = {
    name: 'matrix_compute',
    description:
      'Perform matrix and linear algebra operations. ' +
      'Supports: det (determinant), inv (inverse), transpose, eigenvalues, rank, size, ' +
      'and general matrix expressions. Matrices use mathjs syntax: [[1,2],[3,4]].',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'A matrix expression. Use det([[1,2],[3,4]]), inv([[1,0],[0,1]]), ' +
            'transpose([[1,2],[3,4]]), eigenvalues([[2,1],[1,2]]), etc.'
        },
        format: {
          type: 'string',
          description: 'Output format: "text" (default), "latex", or "all".',
          enum: ['text', 'latex', 'all']
        }
      },
      required: ['expression']
    },
    handler: async (args) => {
      return await computeAsync(args.expression, {
        format: args.format || settings.defaultFormat,
        cache: settings.cacheEnabled,
      });
    }
  };

  api.tools.register(matrixTool);

  const cacheTool = {
    name: 'compute_cache_stats',
    description: 'Get cache statistics for the computation plugin, or clear the cache.',
    useOriginalName: true,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '"stats" to get statistics, "clear" to clear the cache.',
          enum: ['stats', 'clear']
        }
      },
      required: ['action']
    },
    handler: async (args) => {
      if (args.action === 'clear') {
        clearCache();
        return { message: 'Cache cleared', native: getCacheStats(), sympy: getSympyCacheStats() };
      }
      return { native: getCacheStats(), sympy: getSympyCacheStats() };
    }
  };

  api.tools.register(cacheTool);

  api.ws.register('get-settings', async () => settings);
  api.ws.register('update-settings', async (newSettings) => {
    Object.assign(settings, newSettings);
    // Also update the instance reference
    api._pluginInstance.settings = settings;
    await api.settings.set('settings', settings);
    return settings;
  });

  console.log(`[poorman-alpha] Registered tools: compute, sympy_compute, matrix_compute, compute_cache_stats`);
  console.log(`[poorman-alpha] Settings:`, JSON.stringify(settings));
}

export function deactivate(api) {
  console.log(`[poorman-alpha] Deactivating...`);
  shutdownSympy();
  clearCache();
  api._pluginInstance = null;
  console.log(`[poorman-alpha] Deactivated`);
}
