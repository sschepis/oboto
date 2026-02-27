import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Race a promise against an AbortSignal.
 * If the signal is already aborted, rejects immediately.
 * If the signal fires while the promise is pending, rejects with an AbortError.
 * Cleans up the listener once the promise settles.
 *
 * @param {Promise<T>} promise - The promise to race
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<T>}
 */
export function withCancellation(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'));

    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(signal.reason ?? err);
        };
        signal.addEventListener('abort', onAbort);
        promise.then(
            (val) => { signal.removeEventListener('abort', onAbort); resolve(val); },
            (err) => { signal.removeEventListener('abort', onAbort); reject(err); }
        );
    });
}

/**
 * Detect whether an error represents a cancellation (user abort or provider-side cancel).
 * Gemini SDK throws ApiError with status 499 and message containing "CANCELLED".
 * Standard AbortController throws DOMException with name "AbortError".
 * @param {Error} err
 * @returns {boolean}
 */
export function isCancellationError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    if (err.name === 'CancellationError') return true;
    if (err.status === 499) return true;
    if (err.message && (
        err.message.includes('"status":"CANCELLED"') ||
        err.message.includes('The operation was cancelled')
    )) return true;
    return false;
}

/**
 * Retry helper for network operations.
 * Includes a hard wall-clock timeout so the caller never hangs indefinitely.
 * @param {Function} fn - Async function to retry
 * @param {number} retries - Max retries (default 3)
 * @param {number} delay - Initial delay in ms (default 2000)
 * @param {number} totalTimeoutMs - Hard wall-clock timeout across all retries (default 90s)
 */
export async function withRetry(fn, retries = 3, delay = 2000, totalTimeoutMs = 90_000) {
    const deadline = Date.now() + totalTimeoutMs;

    for (let i = 0; i < retries; i++) {
        // Hard timeout: if we've exhausted our wall-clock budget, bail out
        if (Date.now() >= deadline) {
            throw new Error(`[AI Provider] Request timed out after ${totalTimeoutMs / 1000}s (exceeded retry budget)`);
        }

        let result;
        try {
            result = await fn();
        } catch (err) {
            // Never retry cancellation errors — bail immediately
            if (isCancellationError(err)) throw err;

            // Network-level errors (DNS, connection refused, timeouts)
            const isRetryable = err.code === 'UND_ERR_HEADERS_TIMEOUT' ||
                              err.code === 'ETIMEDOUT' ||
                              err.code === 'ECONNRESET' ||
                              (err.message && (
                                  err.message.includes('fetch failed') ||
                                  err.message.includes('timeout') ||
                                  err.message.includes('socket hang up')
                              ));

            if (i === retries - 1 || !isRetryable) throw err;
            
            const waitTime = Math.min(delay * Math.pow(2, i), deadline - Date.now());
            if (waitTime <= 0) {
                throw new Error(`[AI Provider] Request timed out after ${totalTimeoutMs / 1000}s (no time left for retry)`);
            }
            consoleStyler.log('warning', `Request failed (${err.code || err.message}). Retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
        }

        // Handle HTTP error responses from fetch (fetch doesn't throw on 4xx/5xx)
        if (result && typeof result.ok === 'boolean' && !result.ok) {
            const status = result.status;
            const isRetryableStatus = status === 429 || status === 503 || status === 504;

            if (isRetryableStatus && i < retries - 1) {
                // Respect Retry-After header on 429 rate-limit responses
                let waitTime = delay * Math.pow(2, i);
                if (status === 429) {
                    const retryAfter = result.headers?.get?.('retry-after');
                    if (retryAfter) {
                        const parsed = Number(retryAfter);
                        if (!isNaN(parsed)) {
                            // Retry-After is in seconds
                            waitTime = parsed * 1000;
                        } else {
                            // Retry-After is an HTTP-date
                            const retryDate = new Date(retryAfter).getTime();
                            if (!isNaN(retryDate)) {
                                waitTime = Math.max(0, retryDate - Date.now());
                            }
                        }
                    }
                }

                // Clamp wait to remaining budget
                waitTime = Math.min(waitTime, deadline - Date.now());
                if (waitTime <= 0) {
                    throw new Error(`[AI Provider] Request timed out after ${totalTimeoutMs / 1000}s (no time for rate-limit retry)`);
                }

                consoleStyler.log('warning', `HTTP ${status}. Retrying in ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
        }

        return result;
    }
}
