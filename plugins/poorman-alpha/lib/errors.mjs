/**
 * errors.js — Structured error classification for poorman-alpha.
 * Enhancement E-02: Machine-readable error codes.
 */

const ErrorCode = {
  INPUT_INVALID: 'INPUT_INVALID',
  PARSE_ERROR: 'PARSE_ERROR',
  COMPUTATION_ERROR: 'COMPUTATION_ERROR',
  TIMEOUT: 'TIMEOUT',
  DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
  SANITIZATION_FAILED: 'SANITIZATION_FAILED',
  WORKER_ERROR: 'WORKER_ERROR',
  PROCESS_ERROR: 'PROCESS_ERROR',
};

/**
 * Create a structured error result.
 * @param {string} code - Error code from ErrorCode
 * @param {string} message - Human-readable error message
 * @param {string} engine - Engine that produced the error
 * @returns {{ result: null, engine: string, error: string, errorCode: string }}
 */
function makeError(code, message, engine = 'none') {
  return { result: null, engine, error: message, errorCode: code };
}

/**
 * Create a structured success result.
 * @param {string} result - The computation result
 * @param {string} engine - Engine that produced the result
 * @param {object} [extra] - Additional fields (e.g., latex, steps)
 * @returns {{ result: string, engine: string }}
 */
function makeResult(result, engine, extra = {}) {
  return { result, engine, ...extra };
}

export { ErrorCode, makeError, makeResult };
