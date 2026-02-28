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

/**
 * Sanitize an expression for the JavaScript engines (mathjs/nerdamer).
 * @param {string} expression
 * @returns {{ safe: boolean, expression?: string, error?: object }}
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

export { sanitizeJS, MAX_EXPRESSION_LENGTH };
