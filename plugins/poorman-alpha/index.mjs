import { computeAsync, computationalTool, getCacheStats, clearCache } from './native.mjs';
import { callSympy, shutdown as shutdownSympy, getCacheStats as getSympyCacheStats } from './sympy-bridge.mjs';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

const DEFAULT_SETTINGS = {
  pythonPath: 'python3',
  sympyTimeout: 30000,
  nerdamerTimeout: 10000,
  cacheEnabled: true,
  defaultFormat: 'text',
  persistentPython: true,
};

const SETTINGS_SCHEMA = [
  {
    key: 'pythonPath',
    label: 'Python Path',
    type: 'text',
    description: 'Path to the Python 3 interpreter used for SymPy computations.',
    default: 'python3',
  },
  {
    key: 'sympyTimeout',
    label: 'SymPy Timeout (ms)',
    type: 'number',
    description: 'Maximum time in milliseconds to wait for a SymPy computation to complete.',
    default: 30000,
    min: 1000,
    max: 120000,
  },
  {
    key: 'nerdamerTimeout',
    label: 'Nerdamer Timeout (ms)',
    type: 'number',
    description: 'Maximum time in milliseconds to wait for a native (nerdamer) computation to complete.',
    default: 10000,
    min: 1000,
    max: 60000,
  },
  {
    key: 'cacheEnabled',
    label: 'Enable Cache',
    type: 'boolean',
    description: 'Cache computation results to speed up repeated evaluations.',
    default: true,
  },
  {
    key: 'defaultFormat',
    label: 'Default Output Format',
    type: 'select',
    description: 'Default output format for computation results.',
    default: 'text',
    options: [
      { value: 'text', label: 'Text' },
      { value: 'latex', label: 'LaTeX' },
      { value: 'all', label: 'All (Text + LaTeX)' },
    ],
  },
  {
    key: 'persistentPython',
    label: 'Persistent Python Process',
    type: 'boolean',
    description: 'Keep a persistent Python process running for faster SymPy computations.',
    default: true,
  },
];

// NOTE: Plugin state is stored on `api.setInstance()/getInstance()` rather than in a module-level
// variable. This ensures that when the plugin is reloaded (which creates a new
// ES module instance due to cache-busting), the old module's `deactivate()` can
// still reference and clean up state via `api.setInstance()/getInstance()`, and the new module
// starts fresh.

export async function activate(api) {
  consoleStyler.log('plugin', `Activating plugin ${api.id}`);

  // Pre-create instance object to avoid race condition with onSettingsChange callback
  const instanceState = { settings: null };
  api.setInstance(instanceState);

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'poorman-alpha', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
    () => {
      instanceState.settings = pluginSettings;
    }
  );

  instanceState.settings = pluginSettings;

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
      const format = args.format || pluginSettings.defaultFormat;
      const result = await computeAsync(args.expression, {
        format,
        cache: pluginSettings.cacheEnabled,
        timeout: pluginSettings.nerdamerTimeout,
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
        format: args.format || pluginSettings.defaultFormat,
        steps: args.steps || false,
        plot: args.plot || false,
        cache: pluginSettings.cacheEnabled,
        pythonPath: pluginSettings.pythonPath,
        timeout: pluginSettings.sympyTimeout,
        persistent: pluginSettings.persistentPython,
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
        format: args.format || pluginSettings.defaultFormat,
        cache: pluginSettings.cacheEnabled,
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

  consoleStyler.log('plugin', `Registered tools: compute, sympy_compute, matrix_compute, compute_cache_stats`);
  consoleStyler.log('plugin', `Settings: ${JSON.stringify(pluginSettings)}`);
}

export function deactivate(api) {
  consoleStyler.log('plugin', `Deactivating...`);
  shutdownSympy();
  clearCache();
  api.setInstance(null);
  consoleStyler.log('plugin', `Deactivated`);
}
