import fs from 'node:fs/promises';
import path from 'node:path';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

// ── Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  defaultTailLines: 100,
  logLevel: 'info',
};

const SETTINGS_SCHEMA = [
  {
    key: 'defaultTailLines',
    label: 'Default Tail Lines',
    type: 'number',
    description: 'Default number of trailing lines to read from log files.',
    default: 100,
    min: 10,
    max: 10000,
  },
  {
    key: 'logLevel',
    label: 'Log Level',
    type: 'select',
    description: 'Minimum log level for events broadcast to the UI.',
    default: 'info',
    options: [
      { value: 'debug', label: 'Debug' },
      { value: 'info', label: 'Info' },
      { value: 'warn', label: 'Warning' },
      { value: 'error', label: 'Error' },
    ],
  },
];

export async function activate(api) {
  consoleStyler.log('plugin', 'Activating...');

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'logger', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

  const logsDir = path.join(process.cwd(), 'logs');

  // Utility to read log files in the 'logs/' directory
  api.tools.register({
    name: 'read_system_logs',
    useOriginalName: true,
    description: 'Read the contents of a system log file from the logs directory',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Name of the log file (e.g., ai.log). If omitted, returns the list of available log files.'
        },
        lines: {
          type: 'number',
          description: 'Number of trailing lines to read (default from settings)'
        }
      }
    },
    handler: async (args) => {
      try {
        const stats = await fs.stat(logsDir);
        if (!stats.isDirectory()) {
          throw new Error();
        }
      } catch (err) {
        return { error: 'Logs directory not found or inaccessible.' };
      }

      if (!args.filename) {
        const files = await fs.readdir(logsDir);
        return { logFiles: files.filter(f => f.endsWith('.log')) };
      }

      // Security check: ensure path is within logsDir
      const requestedPath = path.normalize(path.join(logsDir, args.filename));
      if (!requestedPath.startsWith(logsDir)) {
        return { error: 'Invalid log file path.' };
      }

      try {
        const content = await fs.readFile(requestedPath, 'utf-8');
        const lines = content.split('\n');
        const numLines = args.lines || pluginSettings.defaultTailLines || 100;
        
        return {
          filename: args.filename,
          content: lines.slice(-numLines).join('\n'),
          totalLines: lines.length
        };
      } catch (err) {
        return { error: `Failed to read log file ${args.filename}: ${err.message}` };
      }
    }
  });

  // Intercept events if applicable to log them
  // Note: we can listen to events emitted by the system
  api.events.onSystem('agent-loop:step', (data) => {
    // Write out interesting data or broadcast to a UI surface
    api.ws.broadcast('logger:event', {
      type: 'agent-loop:step',
      timestamp: Date.now(),
      summary: 'Agent loop step executed'
    });
  });

  api.events.on('workflow-weaver:log', (data) => {
    api.ws.broadcast('logger:event', {
      type: 'workflow-weaver',
      timestamp: Date.now(),
      message: data.message
    });
  });

  consoleStyler.log('plugin', 'Activated.');
}

export function deactivate(api) {
  consoleStyler.log('plugin', 'Deactivated.');
}
