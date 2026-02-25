import path from 'path';
import { fileURLToPath } from 'url';
import * as math from 'mathjs';
import nerdamer from 'nerdamer';
import 'nerdamer/Algebra.js';
import 'nerdamer/Calculus.js';
import 'nerdamer/Solve.js';
import { Worker } from 'worker_threads';

import { ErrorCode, makeError, makeResult } from './lib/errors.mjs';
import { sanitizeJS } from './lib/sanitizer.mjs';
import { classifyExpression } from './lib/router.mjs';
import { LRUCache } from './lib/cache.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cache = new LRUCache(256);

function tryNerdamer(expression, format) {
  try {
    const result = nerdamer(expression);
    const response = makeResult(result.toString(), 'nerdamer');
    if (format === 'latex' || format === 'all') {
      try { response.latex = result.toTeX(); } catch (_e) { /* ignore */ }
    }
    return response;
  } catch (err) {
    throw err;
  }
}

function tryMathjs(expression, format) {
  const result = math.evaluate(expression);
  const response = makeResult(result.toString(), 'mathjs');
  if (format === 'latex' || format === 'all') {
    response.latex = null;
  }
  return response;
}

function tryMatrix(expression) {
  const matOps = {
    det: /^det\((.+)\)$/i,
    inv: /^inv\((.+)\)$/i,
    transpose: /^transpose\((.+)\)$/i,
    eigenvalues: /^eigenvalues\((.+)\)$/i,
    rank: /^rank\((.+)\)$/i,
    size: /^size\((.+)\)$/i,
  };

  for (const [op, re] of Object.entries(matOps)) {
    const match = expression.match(re);
    if (match) {
      try {
        const matExpr = match[1];
        const matrix = math.evaluate(matExpr);
        let result;
        switch (op) {
          case 'det': result = math.det(matrix); break;
          case 'inv': result = math.inv(matrix); break;
          case 'transpose': result = math.transpose(matrix); break;
          case 'eigenvalues': result = math.eigs(matrix).values; break;
          case 'rank': result = math.matrix(matrix).size(); break;
          case 'size': result = math.matrix(matrix).size(); break;
        }
        return makeResult(JSON.stringify(result), 'mathjs-matrix');
      } catch (err) {
        return makeError(ErrorCode.COMPUTATION_ERROR, `Matrix ${op} failed: ${err.message}`, 'mathjs-matrix');
      }
    }
  }

  try {
    const result = math.evaluate(expression);
    if (result && typeof result === 'object' && result._data) {
      return makeResult(JSON.stringify(result._data), 'mathjs-matrix');
    }
  } catch (_e) { }

  return null;
}

function computationalTool(input, options = {}) {
  const { format = 'text', cache: useCache = true } = options;

  const sanitized = sanitizeJS(input);
  if (!sanitized.safe) return sanitized.error;

  const expression = sanitized.expression;
  const cacheKey = `sync:${expression}:${format}`;
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const classification = classifyExpression(expression);
  let result;

  const matrixResult = tryMatrix(expression);
  if (matrixResult) {
    result = matrixResult;
  } else if (classification.route === 'unit_conversion') {
    try {
      result = tryMathjs(expression, format);
    } catch (_e) {
      try { result = tryNerdamer(expression, format); }
      catch (_e2) { result = null; }
    }
  } else if (classification.route === 'symbolic') {
    try {
      result = tryNerdamer(expression, format);
    } catch (_e) {
      try { result = tryMathjs(expression, format); }
      catch (_e2) { result = null; }
    }
  } else if (classification.route === 'arithmetic') {
    try {
      result = tryMathjs(expression, format);
    } catch (_e) {
      try { result = tryNerdamer(expression, format); }
      catch (_e2) { result = null; }
    }
  } else {
    try {
      result = tryNerdamer(expression, format);
    } catch (_e) {
      try { result = tryMathjs(expression, format); }
      catch (_e2) { result = null; }
    }
  }

  if (!result || result.errorCode) {
    result = result || makeError(
      ErrorCode.PARSE_ERROR,
      `Could not evaluate expression: ${expression}`
    );
  }

  result.route = classification.route;
  result.routeConfidence = classification.confidence;

  if (useCache && result.result) {
    cache.set(cacheKey, result);
  }

  return result;
}

function runNerdamerWorker(expression, format, timeout) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'lib', 'nerdamer-worker.mjs');
    const worker = new Worker(workerPath);

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('TIMEOUT'));
    }, timeout);

    worker.on('message', (msg) => {
      clearTimeout(timer);
      worker.terminate();
      if (msg.error) {
        resolve(makeError(ErrorCode.COMPUTATION_ERROR, msg.error, 'nerdamer'));
      } else {
        const result = makeResult(msg.result, 'nerdamer');
        if (msg.latex) result.latex = msg.latex;
        resolve(result);
      }
    });

    worker.on('error', (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    });

    worker.postMessage({ expression, format });
  });
}

async function computeAsync(input, options = {}) {
  const { format = 'text', cache: useCache = true, timeout = 10000 } = options;

  const sanitized = sanitizeJS(input);
  if (!sanitized.safe) return sanitized.error;

  const expression = sanitized.expression;
  const cacheKey = `async:${expression}:${format}`;
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const classification = classifyExpression(expression);

  const matrixResult = tryMatrix(expression);
  if (matrixResult) {
    if (useCache && matrixResult.result) cache.set(cacheKey, matrixResult);
    return { ...matrixResult, route: classification.route };
  }

  if (classification.route === 'unit_conversion' || classification.route === 'arithmetic') {
    try {
      const result = tryMathjs(expression, format);
      result.route = classification.route;
      if (useCache && result.result) cache.set(cacheKey, result);
      return result;
    } catch (_e) { }
  }

  if (Worker) {
    try {
      const result = await runNerdamerWorker(expression, format, timeout);
      result.route = classification.route;
      if (useCache && result.result) cache.set(cacheKey, result);
      return result;
    } catch (err) {
      if (err.message === 'TIMEOUT') {
        return makeError(ErrorCode.TIMEOUT, `Nerdamer timed out after ${timeout}ms`, 'nerdamer');
      }
    }
  }

  const result = computationalTool(input, options);
  return result;
}

function getCacheStats() {
  return cache.stats();
}

function clearCache() {
  cache.clear();
}

export { computationalTool, computeAsync, getCacheStats, clearCache };
