/**
 * WebSocket handlers for the `webllm:support:*` namespace.
 *
 * These handlers receive messages from the browser-side Support LLM engine
 * and relay them to the backend EventBus. They are the server-side half of
 * the WebSocket bridge described in the architecture doc.
 *
 * Direction: Browser → Server (via WebSocket) → EventBus
 *
 * @see docs/architecture/invisible-local-llm-integration.md §4.3
 */

import { consoleStyler } from '../../ui/console-styler.mjs';

export const handlers = {
    /**
     * Browser reports that WebLLM engine is ready and has loaded a model.
     * Payload: { model, contextLength, vram, quantisation }
     */
    'webllm:support:ready': async (data, ctx) => {
        if (ctx.eventBus && data.payload) {
            consoleStyler.log('info', `🧠 WS: Support LLM ready — model: ${data.payload.model || 'unknown'}`);
            ctx.eventBus.emitTyped('webllm:support:ready', data.payload);
        }
    },

    /**
     * Browser reports that WebGPU / WebLLM is not available.
     * Payload: { reason }
     */
    'webllm:support:unavailable': async (data, ctx) => {
        if (ctx.eventBus && data.payload) {
            consoleStyler.log('info', `🧠 WS: Support LLM unavailable — ${data.payload.reason || 'no WebGPU'}`);
            ctx.eventBus.emitTyped('webllm:support:unavailable', data.payload);
        }
    },

    /**
     * Browser sends back a generation result in response to a
     * `webllm:support:generate` request.
     * Payload: { requestId, result?, error? }
     */
    'webllm:support:response': async (data, ctx) => {
        if (ctx.eventBus && data.payload) {
            ctx.eventBus.emitTyped('webllm:support:response', data.payload);
        }
    },

    /**
     * Browser sends a heartbeat / performance status ping.
     * Payload: { timestamp, loadedModel?, tokensPerSecond?, gpuMemoryUsed? }
     */
    'webllm:support:status': async (data, ctx) => {
        if (ctx.eventBus && data.payload) {
            ctx.eventBus.emitTyped('webllm:support:status', data.payload);
        }
    },
};
