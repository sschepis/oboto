/**
 * Support LLM Service — Browser-side WebLLM Engine Management
 *
 * Manages the lifecycle of a local WebLLM engine running in the browser via
 * WebGPU. This service is entirely invisible to the user: no UI elements,
 * no loading screens, no configuration. It bootstraps silently when hardware
 * supports it and responds to backend requests relayed through the WebSocket.
 *
 * Communication flow:
 *   Backend → WS → wsService → supportLlmService → WebLLM engine
 *   WebLLM engine → supportLlmService → wsService → WS → Backend
 *
 * @see docs/architecture/invisible-local-llm-integration.md §4.2
 */

import { wsService } from './wsService';

// ── Types ──────────────────────────────────────────────────────────────────

export type SupportLlmState = 'idle' | 'checking' | 'downloading' | 'ready' | 'unavailable' | 'error';

export interface SupportLlmStatus {
  state: SupportLlmState;
  /** 0–100 progress percentage during 'downloading' state */
  progress: number;
  /** Human-readable status message */
  message: string;
  /** Model name once selected/loaded */
  model?: string;
}

export type SupportLlmStatusListener = (status: SupportLlmStatus) => void;

interface SupportLlmCapabilities {
  model: string;
  contextLength: number;
  quantisation: string;
  webgpu: boolean;
}

interface GenerateRequest {
  requestId: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}

// ── Model selection table ──────────────────────────────────────────────────

/**
 * Auto-selected model based on available VRAM.
 * See docs/architecture/invisible-local-llm-integration.md §4.2.
 */
const MODEL_TABLE = [
  { minVramMb: 6144, model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',  contextLength: 4096, quantisation: 'q4f16_1' },
  { minVramMb: 4096, model: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', contextLength: 2048, quantisation: 'q4f16_1' },
  { minVramMb: 2048, model: 'SmolLM2-360M-Instruct-q4f16_1-MLC',  contextLength: 1024, quantisation: 'q4f16_1' },
];

// ── Service singleton ──────────────────────────────────────────────────────

class SupportLlmService {
  private engine: unknown = null;
  private ready = false;
  private initialising = false;
  private capabilities: SupportLlmCapabilities | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  // ── Status tracking ────────────────────────────────────────────────────
  private _status: SupportLlmStatus = { state: 'idle', progress: 0, message: 'Waiting to initialize…' };
  private _statusListeners: Set<SupportLlmStatusListener> = new Set();

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(listener: SupportLlmStatusListener): () => void {
    this._statusListeners.add(listener);
    // Immediately notify with current status
    listener(this._status);
    return () => { this._statusListeners.delete(listener); };
  }

  /** Get the current status snapshot. */
  getStatus(): SupportLlmStatus {
    return { ...this._status };
  }

  /** Update status and notify all listeners. */
  private setStatus(partial: Partial<SupportLlmStatus>): void {
    this._status = { ...this._status, ...partial };
    for (const listener of this._statusListeners) {
      try { listener(this._status); } catch { /* listener error — non-critical */ }
    }
  }

  /**
   * Initialise the service: register WS listeners and attempt to load
   * the WebLLM engine if WebGPU is available.
   *
   * Called once from App.tsx on mount.
   */
  init(): void {
    // Guard: only initialise once
    if (this.ready || this.initialising) return;

    // Register WebSocket event listeners for the `webllm:support:*` namespace
    this.unsubscribers.push(
      wsService.on('webllm:support:probe', () => {
        this.handleProbe();
      }),
    );

    this.unsubscribers.push(
      wsService.on('webllm:support:generate', (payload: unknown) => {
        this.handleGenerate(payload as GenerateRequest);
      }),
    );

    // When WS connects, attempt to bootstrap the engine
    this.unsubscribers.push(
      wsService.on('connected', () => {
        this.bootstrapEngine();
      }),
    );

    // If already connected, bootstrap immediately
    this.bootstrapEngine();
  }

  /** Clean up listeners and engine. */
  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.ready = false;
    this.engine = null;
    this.capabilities = null;
    this.setStatus({ state: 'idle', progress: 0, message: 'Service destroyed' });
  }

  // ── Engine lifecycle ──────────────────────────────────────────────────

  /**
   * Attempt to initialise the WebLLM engine. This is entirely silent —
   * progress is logged to console only.
   */
  private async bootstrapEngine(): Promise<void> {
    if (this.ready || this.initialising) return;

    // Check WebGPU availability
    if (!this.hasWebGPU()) {
      console.log('[SupportLLM] WebGPU not available — skipping engine init.');
      this.setStatus({ state: 'unavailable', progress: 0, message: 'WebGPU not available' });
      return;
    }

    this.initialising = true;
    this.setStatus({ state: 'checking', progress: 0, message: 'Checking hardware…' });

    try {
      // Dynamic import of @mlc-ai/web-llm — code-split so the large WASM
      // bundle is only fetched when we actually need it.
      // NOTE: The import specifier MUST be a plain string literal (no variable
      // indirection, no @vite-ignore) so that Vite can resolve and bundle it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let webllmModule: any;
      try {
        webllmModule = await import('@mlc-ai/web-llm');
      } catch (e) {
        console.error('[SupportLLM] Failed to import @mlc-ai/web-llm:', e);
        this.initialising = false;
        this.setStatus({ state: 'unavailable', progress: 0, message: 'WebLLM package not available' });
        this.sendUnavailable('@mlc-ai/web-llm package not available');
        return;
      }

      // Create the engine with progress logging (console only)
      const CreateMLCEngine = webllmModule.CreateMLCEngine;
      if (typeof CreateMLCEngine !== 'function') {
        console.log('[SupportLLM] @mlc-ai/web-llm missing CreateMLCEngine — skipping.');
        this.initialising = false;
        this.setStatus({ state: 'unavailable', progress: 0, message: 'Invalid WebLLM version' });
        this.sendUnavailable('Invalid @mlc-ai/web-llm version');
        return;
      }

      // Estimate VRAM for model ranking (used only as a hint, not a hard gate)
      const vramMb = await this.estimateVRAM();
      console.log(`[SupportLLM] Estimated VRAM: ${vramMb}MB`);

      // Build a candidate list: start from the best model the estimate suggests,
      // but always include all models down to the smallest as fallbacks.
      // This ensures that even if the browser under-reports VRAM, we still try.
      const startIndex = MODEL_TABLE.findIndex(m => vramMb >= m.minVramMb);
      const candidates = startIndex >= 0
        ? MODEL_TABLE.slice(startIndex)
        : MODEL_TABLE.slice(); // If VRAM estimate is below all thresholds, try all models smallest-first
      
      // If we're starting from a point where VRAM was too low for everything,
      // reverse so we try smallest first
      if (startIndex < 0) {
        candidates.reverse();
      }

      let lastError: Error | null = null;

      for (const modelEntry of candidates) {
        console.log(`[SupportLLM] Attempting model: ${modelEntry.model} (requires ~${modelEntry.minVramMb}MB, estimated ${vramMb}MB)`);
        this.setStatus({ state: 'downloading', progress: 0, message: `Initializing ${modelEntry.model}…`, model: modelEntry.model });

        try {
          const engine = await CreateMLCEngine(modelEntry.model, {
            initProgressCallback: (progress: { text?: string; progress?: number }) => {
              const pct = Math.round((progress.progress || 0) * 100);
              console.log(`[SupportLLM] Init: ${progress.text || ''} (${pct}%)`);
              this.setStatus({
                state: 'downloading',
                progress: pct,
                message: pct < 100
                  ? `Downloading: ${pct}%`
                  : 'Finalizing model…',
                model: modelEntry.model,
              });
            },
          });

          // Success — engine loaded
          this.engine = engine;
          this.ready = true;
          this.initialising = false;

          this.capabilities = {
            model: modelEntry.model,
            contextLength: modelEntry.contextLength,
            quantisation: modelEntry.quantisation,
            webgpu: true,
          };

          console.log(`[SupportLLM] Engine ready — model: ${modelEntry.model}`);
          this.setStatus({ state: 'ready', progress: 100, message: 'Local AI Ready', model: modelEntry.model });

          // Notify backend
          this.sendReady();

          // Start heartbeat
          this.startHeartbeat();
          return; // Successfully loaded — exit the loop and method

        } catch (err) {
          lastError = err as Error;
          console.warn(`[SupportLLM] Failed to load ${modelEntry.model}: ${lastError.message}`);
          // Continue to try the next (smaller) model
        }
      }

      // All models failed
      console.error('[SupportLLM] All model candidates failed to load.');
      this.initialising = false;
      this.setStatus({
        state: 'error',
        progress: 0,
        message: `All models failed: ${lastError?.message ?? 'unknown error'}`,
      });
      this.sendUnavailable(`All models failed: ${lastError?.message ?? 'unknown error'}`);

    } catch (err) {
      console.error('[SupportLLM] Engine init failed:', err);
      this.initialising = false;
      this.setStatus({ state: 'error', progress: 0, message: `Init failed: ${(err as Error).message}` });
      this.sendUnavailable(`Engine init failed: ${(err as Error).message}`);
    }
  }

  // ── WebSocket message handlers ────────────────────────────────────────

  /**
   * Handle a probe request from the backend.
   * Respond with capabilities if engine is ready, or send an intermediate
   * status if the engine is currently initialising/downloading.
   *
   * IMPORTANT: We must reply *immediately* so the backend's probe timer
   * (default 5 s) does not expire while we're downloading a multi-GB model.
   */
  private handleProbe(): void {
    if (this.ready && this.capabilities) {
      this.sendReady();
    } else if (this.initialising) {
      // Engine is currently downloading / initialising — immediately tell the
      // backend so it doesn't time out while we fetch a multi-GB model.
      this.sendStatus();
    } else if (!this.hasWebGPU()) {
      // No WebGPU — tell backend immediately
      this.sendUnavailable('WebGPU not available');
    } else {
      // Not initialising yet — kick off bootstrap.  Send an immediate
      // "checking" status first so the probe doesn't time out while we
      // dynamically import @mlc-ai/web-llm and estimate VRAM.
      this.sendStatus();
      this.bootstrapEngine().then(() => {
        if (!this.ready) {
          this.sendUnavailable('Engine not available');
        }
      });
    }
  }

  /**
   * Handle a generation request from the backend.
   * Run inference through the WebLLM engine and return the result.
   */
  private async handleGenerate(request: GenerateRequest): Promise<void> {
    if (!this.ready || !this.engine || !request?.requestId) {
      if (request?.requestId) {
        wsService.sendMessage('webllm:support:response', {
          requestId: request.requestId,
          error: 'Support LLM engine not ready',
        });
      }
      return;
    }

    try {
      // Use the OpenAI-compatible chat completions API
      const engineApi = this.engine as {
        chat: {
          completions: {
            create: (params: Record<string, unknown>) => Promise<{
              choices: Array<{ message: { content: string } }>;
            }>;
          };
        };
      };

      const completion = await engineApi.chat.completions.create({
        messages: request.messages,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.max_tokens ?? 256,
        ...(request.response_format ? { response_format: request.response_format } : {}),
      });

      const content = completion.choices?.[0]?.message?.content ?? '';

      wsService.sendMessage('webllm:support:response', {
        requestId: request.requestId,
        result: content,
      });

    } catch (err) {
      console.error('[SupportLLM] Generation error:', err);
      wsService.sendMessage('webllm:support:response', {
        requestId: request.requestId,
        error: (err as Error).message,
      });
    }
  }

  // ── Notification helpers ──────────────────────────────────────────────

  /** Notify backend that the engine is ready with capabilities. */
  private sendReady(): void {
    wsService.sendMessage('webllm:support:ready', this.capabilities);
  }

  /** Notify backend that the engine is unavailable. */
  private sendUnavailable(reason: string): void {
    wsService.sendMessage('webllm:support:unavailable', { reason });
  }

  /**
   * Send intermediate status to the backend so it knows a browser client
   * exists and is actively initialising (downloading, checking, etc.).
   * This prevents the probe timer from expiring during long model downloads.
   */
  private sendStatus(): void {
    wsService.sendMessage('webllm:support:status', {
      state: this._status.state,
      progress: this._status.progress,
      message: this._status.message,
      model: this._status.model,
      timestamp: Date.now(),
    });
  }

  /** Start periodic heartbeat / status pings. */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (!this.ready) {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        return;
      }

      wsService.sendMessage('webllm:support:status', {
        timestamp: Date.now(),
        loadedModel: this.capabilities?.model,
      });
    }, 30_000); // 30 seconds, matching the backend's expected interval
  }

  // ── Hardware detection ────────────────────────────────────────────────

  /** Check if WebGPU is available in the current browser. */
  private hasWebGPU(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  /**
   * Estimate available VRAM in MB.
   *
   * IMPORTANT: Browser WebGPU implementations (especially Chrome) heavily cap
   * reported limits like `maxBufferSize` and `maxStorageBufferBindingSize` for
   * security reasons. On Apple Silicon Macs with unified memory, the browser
   * may report as little as 256MB–1GB despite the machine having 16–192GB of
   * usable memory. Therefore this estimate is used only as a **hint** for
   * model ranking, never as a hard gate.
   *
   * Strategy:
   *  1. Query WebGPU adapter limits (maxBufferSize, maxStorageBufferBindingSize).
   *  2. Use navigator.deviceMemory (Chrome only) as an additional signal.
   *  3. On Apple platforms (likely unified memory), be generous — assume at
   *     least 75% of system RAM is available for GPU work.
   *  4. Take the maximum across all signals.
   *  5. Default generously (8GB) when detection fails entirely.
   */
  private async estimateVRAM(): Promise<number> {
    const signals: number[] = [];

    try {
      if (!('gpu' in navigator)) return 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gpu = (navigator as any).gpu;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return 0;

      // --- Signal 1: WebGPU adapter limits ---
      try {
        const device = await adapter.requestDevice({ requiredLimits: {} });
        const maxBuffer = device.limits.maxBufferSize;
        const maxStorage = device.limits.maxStorageBufferBindingSize;
        device.destroy();

        // Use whichever is larger, apply 2× multiplier as a heuristic
        const gpuLimit = Math.max(maxBuffer || 0, maxStorage || 0);
        if (gpuLimit > 0) {
          const estimatedMb = Math.round((gpuLimit / (1024 * 1024)) * 2);
          signals.push(estimatedMb);
          console.log(`[SupportLLM] WebGPU limits estimate: ${estimatedMb}MB (maxBuffer=${maxBuffer}, maxStorage=${maxStorage})`);
        }
      } catch (e) {
        console.warn('[SupportLLM] Could not query WebGPU device limits:', e);
      }

      // --- Signal 2: navigator.deviceMemory (Chrome/Edge only) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deviceMemoryGb = (navigator as any).deviceMemory;
      if (typeof deviceMemoryGb === 'number' && deviceMemoryGb > 0) {
        // On unified memory systems (Apple Silicon), most system RAM is
        // available for GPU. On discrete GPU systems, deviceMemory reflects
        // system RAM, not VRAM — but we use it as a floor since the user
        // clearly has a capable machine.
        const isApple = /Mac|iPhone|iPad/.test(navigator.userAgent);
        const fraction = isApple ? 0.75 : 0.25;
        const estimatedMb = Math.round(deviceMemoryGb * 1024 * fraction);
        signals.push(estimatedMb);
        console.log(`[SupportLLM] deviceMemory estimate: ${estimatedMb}MB (${deviceMemoryGb}GB system RAM, fraction=${fraction})`);
      }

      // --- Signal 3: Apple Silicon heuristic ---
      // Apple Silicon Macs use unified memory — GPU and CPU share the same
      // pool. If we detect an Apple platform, set a generous floor.
      const isApplePlatform = /Mac|iPhone|iPad/.test(navigator.userAgent);
      if (isApplePlatform) {
        // Assume at least 8GB available for GPU on any modern Apple Silicon Mac
        signals.push(8192);
        console.log('[SupportLLM] Apple platform detected — adding 8GB floor');
      }

      // Return the maximum across all signals, or a generous default
      if (signals.length > 0) {
        const best = Math.max(...signals);
        console.log(`[SupportLLM] Final VRAM estimate: ${best}MB (from ${signals.length} signals: [${signals.join(', ')}])`);
        return best;
      }

      // Conservative fallback: if WebGPU is available but we couldn't estimate,
      // try the mid-tier model first to avoid OOM on constrained hardware.
      console.log('[SupportLLM] No VRAM signals — using conservative default of 4096MB');
      return 4096;

    } catch {
      // If anything goes wrong, assume a conservative default
      console.log('[SupportLLM] VRAM estimation failed — using default of 4096MB');
      return 4096;
    }
  }
}

// Export singleton
export const supportLlmService = new SupportLlmService();
