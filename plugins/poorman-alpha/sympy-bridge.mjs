/**
 * sympy-bridge.js — Enhanced subprocess bridge to SymPy.
 *
 * Integrates:
 *   E-01: Input sanitization (Python-specific)
 *   E-02: Structured error classification
 *   E-04: Persistent Python process (JSON-line IPC)
 *   E-05: Expression result caching
 *   E-07: LaTeX output format
 *   E-08: Step-by-step solution mode
 *   E-10: Graph/plot generation
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { ErrorCode, makeError, makeResult } from './lib/errors.mjs';
import { sanitizePython } from './lib/sanitizer.mjs';
import { LRUCache } from './lib/cache.mjs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { consoleStyler } from '../../src/ui/console-styler.mjs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOLVER_SCRIPT = path.join(__dirname, 'solver.py');
const ONESHOT_TIMEOUT_MS = 30000;

// ── Venv auto-detection ─────────────────────────────────────────────
const IS_WIN = process.platform === 'win32';
const VENV_PYTHON = IS_WIN
  ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
  : path.join(__dirname, '.venv', 'bin', 'python3');

/**
 * Resolve the Python path to use. Priority:
 *  1. Explicit override (from settings)
 *  2. Plugin-local .venv/bin/python3
 *  3. System 'python3'
 */
function resolvePythonPath(override) {
  if (override && override !== 'python3') return override;
  try {
    if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  } catch (_) {}
  return 'python3';
}

// Cache instance for SymPy results (E-05)
const sympyCache = new LRUCache(128);

// ── Persistent Process Manager (E-04) ───────────────────────────────

let persistentProcess = null;
let processReady = false;
let pendingRequests = new Map();
let requestIdCounter = 0;

/**
 * Get or spawn the persistent Python process.
 */
function getPersistentProcess(pythonPath) {
  if (persistentProcess && !persistentProcess.killed) {
    return persistentProcess;
  }

  const resolvedPython = resolvePythonPath(pythonPath);
  try {
    persistentProcess = spawn(resolvedPython, [SOLVER_SCRIPT, '--persistent'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let buffer = '';
    persistentProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.status === 'ready') {
            processReady = true;
            continue;
          }
          const pending = pendingRequests.get(response.id);
          if (pending) {
            pendingRequests.delete(response.id);
            clearTimeout(pending.timer);
            pending.resolve(response);
          }
        } catch (_e) {
          // Ignore non-JSON output
        }
      }
    });

    persistentProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) consoleStyler.log('warning', `stderr: ${msg}`);
    });

    persistentProcess.on('close', (code) => {
      consoleStyler.log('plugin', `Python process exited with code ${code}`);
      processReady = false;
      persistentProcess = null;
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.resolve({ error: `Python process exited with code ${code}` });
        pendingRequests.delete(id);
      }
    });

    persistentProcess.on('error', (err) => {
      processReady = false;
      persistentProcess = null;
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.resolve({ error: err.code === 'ENOENT'
          ? 'python3 not found. Install Python 3 and sympy to use advanced math features.'
          : err.message });
        pendingRequests.delete(id);
      }
    });

    return persistentProcess;
  } catch (err) {
    persistentProcess = null;
    return null;
  }
}

/**
 * Send a request to the persistent process.
 */
function sendPersistentRequest(request, timeout = ONESHOT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const proc = getPersistentProcess(request.pythonPath);
    if (!proc || proc.killed) {
      resolve({ error: 'Failed to start Python process' });
      return;
    }

    const id = ++requestIdCounter;
    const msg = JSON.stringify({ ...request, id }) + '\n';

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve({ error: `SymPy computation timed out after ${timeout}ms` });
    }, timeout);

    pendingRequests.set(id, { resolve, timer });

    try {
      proc.stdin.write(msg);
    } catch (err) {
      pendingRequests.delete(id);
      clearTimeout(timer);
      resolve({ error: `Failed to write to Python process: ${err.message}` });
    }
  });
}

// ── One-shot process (fallback) ─────────────────────────────────────

/**
 * Execute via one-shot subprocess (used when persistent process unavailable).
 */
function callSympyOneshot(expression, options = {}) {
  return new Promise((resolve) => {
    const { pythonPath, timeout = ONESHOT_TIMEOUT_MS, format = 'text' } = options;
    const resolvedPython = resolvePythonPath(pythonPath);
    const args = [SOLVER_SCRIPT, expression];
    if (format === 'latex') args.push('--latex');
    if (format === 'all') args.push('--all');
    if (options.steps) args.push('--steps');

    const python = spawn(resolvedPython, args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => { stdout += data.toString(); });
    python.stderr.on('data', (data) => { stderr += data.toString(); });

    python.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        // Try to parse as JSON (enhanced solver)
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(makeResult(parsed.result, 'sympy', {
            latex: parsed.latex || null,
            steps: parsed.steps || null,
            plot: parsed.plot || null,
          }));
        } catch (_e) {
          // Plain text output
          resolve(makeResult(stdout.trim(), 'sympy'));
        }
      } else {
        const errorMsg = stderr.trim() || `Python process exited with code ${code}`;
        if (errorMsg.includes('not installed')) {
          resolve(makeError(ErrorCode.DEPENDENCY_MISSING, errorMsg, 'sympy'));
        } else {
          resolve(makeError(ErrorCode.COMPUTATION_ERROR, errorMsg, 'sympy'));
        }
      }
    });

    python.on('error', (err) => {
      if (err.code === 'ENOENT') {
        resolve(makeError(
          ErrorCode.DEPENDENCY_MISSING,
          `${pythonPath} not found. Install Python 3 and sympy to use advanced math features.`,
          'sympy'
        ));
      } else {
        resolve(makeError(ErrorCode.PROCESS_ERROR, err.message, 'sympy'));
      }
    });
  });
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Execute a SymPy expression with all enhancements.
 *
 * @param {string} expression
 * @param {{ format?: string, steps?: boolean, plot?: boolean, cache?: boolean, pythonPath?: string, timeout?: number, persistent?: boolean }} options
 * @returns {Promise<object>}
 */
async function callSympy(expression, options = {}) {
  const {
    format = 'text',
    steps = false,
    plot = false,
    cache: useCache = true,
    pythonPath = 'python3',
    timeout = ONESHOT_TIMEOUT_MS,
    persistent = true,
  } = options;

  // E-01: Sanitize
  const sanitized = sanitizePython(expression);
  if (!sanitized.safe) return sanitized.error;

  const cleanExpr = sanitized.expression;

  // E-05: Check cache (plots are not cached)
  const cacheKey = `sympy:${cleanExpr}:${format}:${steps}`;
  if (useCache && !plot) {
    const cached = sympyCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  let result;

  // E-04: Try persistent process first
  if (persistent) {
    const response = await sendPersistentRequest({
      expression: cleanExpr,
      format,
      steps,
      plot,
      pythonPath,
    }, timeout);

    if (response.error) {
      // Fall back to one-shot
      result = await callSympyOneshot(cleanExpr, { pythonPath, timeout, format, steps });
    } else {
      result = makeResult(response.result, 'sympy', {
        latex: response.latex || null,
        steps: response.steps || null,
        plot: response.plot || null,
      });
    }
  } else {
    result = await callSympyOneshot(cleanExpr, { pythonPath, timeout, format, steps });
  }

  // E-05: Cache success results
  if (useCache && !plot && result.result) {
    sympyCache.set(cacheKey, result);
  }

  return result;
}

/**
 * Shutdown the persistent Python process.
 */
function shutdown() {
  if (persistentProcess && !persistentProcess.killed) {
    try {
      persistentProcess.stdin.write(JSON.stringify({ command: 'exit' }) + '\n');
      setTimeout(() => {
        if (persistentProcess && !persistentProcess.killed) {
          persistentProcess.kill();
        }
      }, 1000);
    } catch (_e) {
      persistentProcess.kill();
    }
  }
  persistentProcess = null;
  processReady = false;
}

/**
 * Get SymPy cache statistics.
 */
function getCacheStats() {
  return sympyCache.stats();
}

export { callSympy, shutdown, getCacheStats };
