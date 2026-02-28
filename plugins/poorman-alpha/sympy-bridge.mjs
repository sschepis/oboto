/**
 * sympy-bridge.mjs — Pure JS symbolic math engine for poorman-alpha.
 *
 * Replaces the previous Python/SymPy subprocess bridge with nerdamer's
 * built-in Calculus module for integration, differentiation, limits,
 * series expansion, and advanced symbolic operations.
 *
 * All computation is done in-process — no Python dependency required.
 */

import nerdamer from 'nerdamer';
import 'nerdamer/Algebra.js';
import 'nerdamer/Calculus.js';
import 'nerdamer/Solve.js';
import * as math from 'mathjs';

import { ErrorCode, makeError, makeResult } from './lib/errors.mjs';
import { sanitizeJS } from './lib/sanitizer.mjs';
import { LRUCache } from './lib/cache.mjs';

const DEFAULT_TIMEOUT_MS = 30000;

// Cache instance for advanced math results
const advancedCache = new LRUCache(128);

/**
 * Map SymPy-style expression syntax to nerdamer-compatible syntax.
 * This handles common expressions that users might write in SymPy notation.
 */
function normalizeExpression(expression) {
  let expr = expression.trim();

  // Map Python ** to ^
  expr = expr.replace(/\*\*/g, '^');

  // Map SymPy-style function names that differ
  // ln() -> log() in nerdamer
  expr = expr.replace(/\bln\(/g, 'log(');

  // SymPy's oo -> Infinity
  expr = expr.replace(/\boo\b/g, 'Infinity');

  return expr;
}

/**
 * Attempt to evaluate using nerdamer's symbolic engine.
 */
function evaluateNerdamer(expression, format = 'text') {
  const normalized = normalizeExpression(expression);
  const result = nerdamer(normalized);
  const response = { result: result.toString() };

  if (format === 'latex' || format === 'all') {
    try {
      response.latex = result.toTeX();
    } catch (_e) {
      response.latex = null;
    }
  }

  return response;
}

/**
 * Generate step-by-step solution breakdown.
 */
function generateSteps(expression) {
  const steps = [];
  const exprLower = expression.toLowerCase().trim();

  try {
    if (exprLower.startsWith('integrate(') || exprLower.startsWith('integrate(')) {
      steps.push(`Step 1: Identify the integrand from: ${expression}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 2: Apply integration rules`);
      steps.push(`Step 3: Result: ${result.toString()}`);
    } else if (exprLower.startsWith('diff(')) {
      steps.push(`Step 1: Identify function to differentiate from: ${expression}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 2: Apply differentiation rules`);
      steps.push(`Step 3: Derivative: ${result.toString()}`);
    } else if (exprLower.startsWith('solve(')) {
      steps.push(`Step 1: Parse equation from: ${expression}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 2: Apply algebraic solving techniques`);
      steps.push(`Step 3: Solutions: ${result.toString()}`);
    } else if (exprLower.startsWith('expand(')) {
      const inner = expression.slice(7, -1);
      steps.push(`Step 1: Parse expression: ${inner}`);
      const original = nerdamer(normalizeExpression(inner));
      steps.push(`Step 2: Original form: ${original.toString()}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 3: Expanded form: ${result.toString()}`);
    } else if (exprLower.startsWith('factor(')) {
      const inner = expression.slice(7, -1);
      steps.push(`Step 1: Parse expression: ${inner}`);
      const original = nerdamer(normalizeExpression(inner));
      steps.push(`Step 2: Original form: ${original.toString()}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 3: Factored form: ${result.toString()}`);
    } else if (exprLower.startsWith('simplify(')) {
      const inner = expression.slice(9, -1);
      steps.push(`Step 1: Parse expression: ${inner}`);
      const original = nerdamer(normalizeExpression(inner));
      steps.push(`Step 2: Original form: ${original.toString()}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 3: Simplified form: ${result.toString()}`);
    } else {
      steps.push(`Step 1: Evaluate expression: ${expression}`);
      const result = nerdamer(normalizeExpression(expression));
      steps.push(`Step 2: Result: ${result.toString()}`);
    }
  } catch (e) {
    steps.push(`Error generating steps: ${e.message}`);
  }

  return steps;
}

/**
 * Generate a text-based function table as a plot substitute.
 * Since we no longer have matplotlib, we provide numeric samples.
 */
function generateFunctionTable(expression) {
  try {
    const normalized = normalizeExpression(expression);
    // Try to evaluate at sample points using mathjs
    const points = [];
    const xValues = [-10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10];

    for (const x of xValues) {
      try {
        // Replace 'x' with the numeric value
        const withValue = normalized.replace(/\bx\b/g, `(${x})`);
        const y = math.evaluate(withValue);
        if (typeof y === 'number' && isFinite(y)) {
          points.push({ x, y: Math.round(y * 10000) / 10000 });
        }
      } catch (_e) {
        // Skip points that can't be evaluated
      }
    }

    if (points.length > 0) {
      return {
        type: 'function_table',
        expression: normalized,
        points,
        note: 'Plot generation requires a graphical environment. Here is a function table with sample values.'
      };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Execute an advanced symbolic math expression using nerdamer.
 * Drop-in replacement for the previous Python/SymPy bridge.
 *
 * @param {string} expression
 * @param {{ format?: string, steps?: boolean, plot?: boolean, cache?: boolean, timeout?: number }} options
 * @returns {Promise<object>}
 */
async function callSympy(expression, options = {}) {
  const {
    format = 'text',
    steps = false,
    plot = false,
    cache: useCache = true,
    timeout = DEFAULT_TIMEOUT_MS,
  } = options;

  // Sanitize input (reuse JS sanitizer since we're no longer calling Python)
  const sanitized = sanitizeJS(expression);
  if (!sanitized.safe) return sanitized.error;

  const cleanExpr = sanitized.expression;

  // Check cache
  const cacheKey = `advanced:${cleanExpr}:${format}:${steps}`;
  if (useCache && !plot) {
    const cached = advancedCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  // Execute with timeout
  let result;
  try {
    result = await Promise.race([
      Promise.resolve().then(() => evaluateNerdamer(cleanExpr, format)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Computation timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  } catch (err) {
    if (err.message.includes('timed out')) {
      return makeError(ErrorCode.TIMEOUT, err.message, 'nerdamer-advanced');
    }
    // Try mathjs as fallback
    try {
      const mathjsResult = math.evaluate(normalizeExpression(cleanExpr).replace(/\^/g, '**'));
      result = { result: String(mathjsResult) };
      if (format === 'latex' || format === 'all') {
        result.latex = null;
      }
    } catch (_e2) {
      return makeError(ErrorCode.COMPUTATION_ERROR, err.message, 'nerdamer-advanced');
    }
  }

  const response = makeResult(result.result, 'nerdamer-advanced', {
    latex: result.latex || null,
  });

  // Step-by-step breakdown
  if (steps) {
    response.steps = generateSteps(cleanExpr);
  }

  // Plot substitute (function table)
  if (plot) {
    const table = generateFunctionTable(cleanExpr);
    if (table) {
      response.plot = table;
    }
  }

  // Cache success results
  if (useCache && !plot && response.result) {
    advancedCache.set(cacheKey, response);
  }

  return response;
}

/**
 * Shutdown — no-op since we no longer have a persistent Python process.
 */
function shutdown() {
  // No-op: no external process to shut down
}

/**
 * Get cache statistics.
 */
function getCacheStats() {
  return advancedCache.stats();
}

export { callSympy, shutdown, getCacheStats };
