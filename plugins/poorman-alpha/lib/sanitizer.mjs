/**
 * sanitizer.js — Input sanitization layer for poorman-alpha.
 * Enhancement E-01: Blocks dangerous patterns before evaluation.
 */

import { ErrorCode, makeError } from './errors.mjs';

const MAX_EXPRESSION_LENGTH = 2000;

// Patterns that should never appear in a math expression
const DANGEROUS_PATTERNS = [
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bprocess\b/i,
  /\b__proto__\b/i,
  /\b__dirname\b/i,
  /\b__filename\b/i,
  /\bconstructor\b/i,
  /\bprototype\b/i,
  /\bglobal\b/i,
  /\bwindow\b/i,
  /\bdocument\b/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bsetTimeout\s*\(/i,
  /\bsetInterval\s*\(/i,
  /\bchild_process\b/i,
  /\bexecSync\b/i,
  /\bspawnSync\b/i,
  /\bfs\.\b/i,
  /\brm\s+-rf\b/i,
];

// Python-specific dangerous patterns for solver.py
const PYTHON_DANGEROUS_PATTERNS = [
  /\bimport\b/i,
  /\b__import__\b/i,
  /\bexec\s*\(/i,
  /\bcompile\s*\(/i,
  /\bopen\s*\(/i,
  /\bos\.\b/i,
  /\bsubprocess\b/i,
  /\bsys\.\b/i,
  /\bshutil\b/i,
  /\bglobals\s*\(/i,
  /\blocals\s*\(/i,
  /\bgetattr\s*\(/i,
  /\bsetattr\s*\(/i,
  /\bdelattr\s*\(/i,
  /\b__builtins__\b/i,
  /\b__class__\b/i,
  /\b__subclasses__\b/i,
];

/**
 * Sanitize an expression for the JavaScript engines (mathjs/nerdamer).
 * @param {string} expression
 * @returns {{ safe: boolean, error?: object }}
 */
function sanitizeJS(expression) {
  if (!expression || typeof expression !== 'string') {
    return { safe: false, error: makeError(ErrorCode.INPUT_INVALID, 'Input must be a non-empty string.') };
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    return { safe: false, error: makeError(ErrorCode.INPUT_INVALID, 'Input must be a non-empty string.') };
  }

  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    return {
      safe: false,
      error: makeError(ErrorCode.INPUT_INVALID, `Expression too long (${trimmed.length} chars, max ${MAX_EXPRESSION_LENGTH}).`)
    };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        error: makeError(ErrorCode.SANITIZATION_FAILED, `Expression contains disallowed pattern: ${pattern.source}`)
      };
    }
  }

  return { safe: true, expression: trimmed };
}

/**
 * Sanitize an expression for the Python/SymPy engine.
 * @param {string} expression
 * @returns {{ safe: boolean, error?: object }}
 */
function sanitizePython(expression) {
  if (!expression || typeof expression !== 'string') {
    return { safe: false, error: makeError(ErrorCode.INPUT_INVALID, 'Expression must be a non-empty string.', 'sympy') };
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    return { safe: false, error: makeError(ErrorCode.INPUT_INVALID, 'Expression must be a non-empty string.', 'sympy') };
  }

  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    return {
      safe: false,
      error: makeError(ErrorCode.INPUT_INVALID, `Expression too long (${trimmed.length} chars, max ${MAX_EXPRESSION_LENGTH}).`, 'sympy')
    };
  }

  for (const pattern of PYTHON_DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        error: makeError(ErrorCode.SANITIZATION_FAILED, `Expression contains disallowed pattern: ${pattern.source}`, 'sympy')
      };
    }
  }

  return { safe: true, expression: trimmed };
}

export { sanitizeJS, sanitizePython, MAX_EXPRESSION_LENGTH };
