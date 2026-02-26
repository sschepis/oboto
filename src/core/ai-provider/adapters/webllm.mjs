import { config } from '../../../config.mjs';

// WebLLM bridge — eventBus reference for routing requests to browser
let _eventBus = null;
let _responseHandler = null; // stored so we can remove it on re-assignment
const _webllmPending = new Map(); // requestId → { resolve, reject, timer }

/**
 * Set the EventBus reference for WebLLM provider.
 * WebLLM runs in the browser — the server routes requests through WS via EventBus.
 * Called from main.mjs or web-server.mjs.
 * @param {object|null} eventBus
 */
export function setEventBusRef(eventBus) {
    // Remove previous listener to prevent accumulation on repeated calls
    if (_eventBus && _responseHandler) {
        _eventBus.off('webllm:response', _responseHandler);
        _responseHandler = null;
    }
    _eventBus = eventBus;
    if (_eventBus) {
        // Listen for webllm:response events from browser
        _responseHandler = (data) => {
            const pending = _webllmPending.get(data.requestId);
            if (pending) {
                clearTimeout(pending.timer);
                _webllmPending.delete(data.requestId);
                if (data.error) {
                    pending.reject(new Error(data.error));
                } else {
                    pending.resolve(data.result);
                }
            }
        };
        _eventBus.on('webllm:response', _responseHandler);
    }
}

/**
 * Route an AI request to the browser-side WebLLM engine via EventBus.
 * The server emits 'webllm:generate' on the event bus, which gets broadcast
 * to the WS client. The UI runs the model via @mlc-ai/web-llm and sends
 * 'webllm:response' back, which resolves the pending promise.
 *
 * @param {Object} requestBody — OpenAI-compatible request body
 * @returns {Promise<Object>} OpenAI-compatible response
 */
export async function callWebLLM(requestBody) {
    if (!_eventBus) {
        throw new Error('WebLLM requires a connected browser client. Open the Oboto UI in your browser.');
    }

    const requestId = `webllm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const TIMEOUT_MS = 300000; // 5 minutes — local models can be slow

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            _webllmPending.delete(requestId);
            reject(new Error('WebLLM request timed out. Make sure the browser tab is open and the model is loaded.'));
        }, TIMEOUT_MS);

        _webllmPending.set(requestId, { resolve, reject, timer });

        // Emit request to be broadcast to WS clients
        _eventBus.emitTyped('webllm:generate', {
            requestId,
            model: requestBody.model || config.ai.model,
            messages: requestBody.messages,
            temperature: requestBody.temperature,
            max_tokens: requestBody.max_tokens,
            // Note: tool calling not supported in WebLLM for most models
        });
    });
}
