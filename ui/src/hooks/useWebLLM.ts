import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/wsService';

/**
 * Recommended models for WebLLM — matches the server-side list.
 * These are MLC-compiled models optimized for WebGPU inference.
 */
export const WEBLLM_MODELS = [
  {
    id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 Coder 7B (recommended)',
    description: 'Best for coding tasks. Strong tool-calling support. Requires ~5GB VRAM.',
    vram: '5GB',
    quality: 'high' as const,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 3B',
    description: 'Good balance of quality and speed. Fits in 3GB VRAM.',
    vram: '3GB',
    quality: 'medium' as const,
  },
  {
    id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    name: 'Phi 3.5 Mini',
    description: 'Compact and fast. Great for simple tasks. ~2GB VRAM.',
    vram: '2GB',
    quality: 'medium' as const,
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 3B',
    description: 'Strong multilingual support. Good reasoning. ~3GB VRAM.',
    vram: '3GB',
    quality: 'medium' as const,
  },
];

export type WebLLMStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

interface WebLLMState {
  status: WebLLMStatus;
  loadedModel: string | null;
  loadProgress: number; // 0-100
  error: string | null;
  webgpuAvailable: boolean;
}

/**
 * React hook for the WebLLM in-browser AI engine.
 * 
 * When the server sets AI_PROVIDER=webllm, it sends `webllm:generate` requests
 * to the browser via WS. This hook loads a model using @mlc-ai/web-llm,
 * processes requests, and sends results back via `webllm:response`.
 * 
 * The model runs entirely in the browser using WebGPU — no API keys needed,
 * no data leaves the user's machine.
 */
export function useWebLLM() {
  const [state, setState] = useState<WebLLMState>({
    status: 'idle',
    loadedModel: null,
    loadProgress: 0,
    error: null,
    webgpuAvailable: false,
  });

  // Use ref for the engine to avoid re-renders
  const engineRef = useRef<any>(null);
  const loadingRef = useRef(false);

  // Check WebGPU availability on mount
  useEffect(() => {
    const checkWebGPU = async () => {
      try {
        if ('gpu' in navigator) {
          const adapter = await (navigator as any).gpu?.requestAdapter();
          setState(prev => ({ ...prev, webgpuAvailable: !!adapter }));
        }
      } catch {
        setState(prev => ({ ...prev, webgpuAvailable: false }));
      }
    };
    checkWebGPU();
  }, []);

  // Listen for webllm:generate requests from server
  useEffect(() => {
    const unsub = wsService.on('webllm:generate', async (payload: unknown) => {
      const req = payload as {
        requestId: string;
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
      };

      if (!engineRef.current) {
        // Engine not loaded — send error back
        wsService.sendMessage('webllm:response', {
          requestId: req.requestId,
          error: 'WebLLM engine not loaded. Please load a model first in Settings → AI Providers.',
        });
        return;
      }

      setState(prev => ({ ...prev, status: 'generating' }));

      try {
        const result = await engineRef.current.chat.completions.create({
          messages: req.messages,
          temperature: req.temperature ?? 0.7,
          max_tokens: req.max_tokens ?? 4096,
        });

        // Send OpenAI-compatible response back to server
        wsService.sendMessage('webllm:response', {
          requestId: req.requestId,
          result: {
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: result.choices[0]?.message?.content || '',
              },
              finish_reason: result.choices[0]?.finish_reason || 'stop',
            }],
            usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          },
        });
      } catch (err: any) {
        wsService.sendMessage('webllm:response', {
          requestId: req.requestId,
          error: `WebLLM generation failed: ${err.message}`,
        });
      } finally {
        setState(prev => ({ ...prev, status: 'ready' }));
      }
    });

    return () => unsub();
  }, []);

  // Load a model
  const loadModel = useCallback(async (modelId: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    setState(prev => ({
      ...prev,
      status: 'loading',
      loadProgress: 0,
      error: null,
    }));

    try {
      // Dynamic import — @mlc-ai/web-llm is only loaded when needed
      const webllm = await import('@mlc-ai/web-llm');

      const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (progress: any) => {
          const pct = typeof progress === 'object' ? Math.round((progress.progress || 0) * 100) : 0;
          setState(prev => ({ ...prev, loadProgress: pct }));
          // Broadcast loading progress to server for status display
          wsService.sendMessage('webllm:status', {
            status: 'loading',
            model: modelId,
            progress: pct,
          });
        },
      });

      engineRef.current = engine;
      setState(prev => ({
        ...prev,
        status: 'ready',
        loadedModel: modelId,
        loadProgress: 100,
        error: null,
      }));

      wsService.sendMessage('webllm:status', {
        status: 'ready',
        model: modelId,
      });
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: err.message,
        loadProgress: 0,
      }));

      wsService.sendMessage('webllm:status', {
        status: 'error',
        error: err.message,
      });
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // Unload the current model
  const unloadModel = useCallback(async () => {
    if (engineRef.current) {
      try {
        await engineRef.current.unload();
      } catch { /* ignore */ }
      engineRef.current = null;
    }
    setState(prev => ({
      ...prev,
      status: 'idle',
      loadedModel: null,
      loadProgress: 0,
      error: null,
    }));

    wsService.sendMessage('webllm:status', { status: 'idle' });
  }, []);

  return {
    ...state,
    models: WEBLLM_MODELS,
    loadModel,
    unloadModel,
  };
}
