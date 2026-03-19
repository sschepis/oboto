/**
 * CanvasVizBlock — Renders a `canvasviz` code fence as a live interactive
 * HTML5 Canvas visualization inside a sandboxed iframe.
 *
 * The canvas-viz plugin generates JS code that defines a class extending
 * `CanvasVisualization`, instantiates it with `'canvas'` as the canvas ID,
 * and calls `.start()`. This component:
 *
 * 1. Creates a sandboxed `<iframe>` with `sandbox="allow-scripts"`
 * 2. Injects the CanvasVisualization base class + generated code via `srcdoc`
 * 3. Uses `postMessage` for play/pause/restart control
 * 4. Handles cleanup on unmount
 *
 * SECURITY: All AI-generated code runs inside an iframe sandbox which
 * prevents access to the parent page's DOM, cookies, localStorage, and JS
 * context. The `allow-scripts` permission is required for the canvas animation
 * but the sandbox prevents same-origin access by default.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Play, Pause, RotateCcw, Palette } from 'lucide-react';

interface CanvasVizBlockProps {
  code: string;
}

const WIDTH = 800;
const HEIGHT = 500;

/**
 * Build the srcdoc HTML for the sandboxed iframe.
 * Contains the base class, the AI-generated code, and a postMessage listener
 * for play/pause/restart commands from the parent.
 */
function buildSrcdoc(code: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0d0d0d; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 100vh; }
  canvas { display: block; }
  .error { color: #f87171; font-family: monospace; font-size: 12px; padding: 16px; white-space: pre-wrap; }
</style>
</head>
<body>
<canvas id="canvas" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script>
// ── Base class ──
class CanvasVisualization {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error('Canvas element not found: ' + canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this._running = false;
    this._rafId = null;
    this._startTime = null;
    this.time = 0;
    this.deltaTime = 0;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now();
    this._lastFrame = this._startTime;
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop() {
    if (!this._running) return;
    var now = performance.now();
    this.deltaTime = (now - this._lastFrame) / 1000;
    this.time = (now - this._startTime) / 1000;
    this._lastFrame = now;
    this.animate();
    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  animate() {
    this.update();
    this.draw();
  }

  update() {}
  draw() {}
}

// ── Capture instance ──
var __vizInstance = null;
var _origStart = CanvasVisualization.prototype.start;
CanvasVisualization.prototype.start = function() {
  __vizInstance = this;
  return _origStart.call(this);
};

// ── Execute AI-generated code ──
try {
  ${code}
  // Notify parent of success
  window.parent.postMessage({ type: 'canvasviz-ready', ok: true }, '*');
} catch (e) {
  document.body.innerHTML = '<div class="error">Canvas Visualization Error\\n' + e.message + '</div>';
  window.parent.postMessage({ type: 'canvasviz-ready', ok: false, error: e.message }, '*');
}

// ── Listen for parent commands ──
window.addEventListener('message', function(event) {
  var data = event.data;
  if (!data || data.type !== 'canvasviz-cmd') return;
  var inst = __vizInstance;
  if (!inst) return;

  switch (data.action) {
    case 'play':
      if (!inst._running) inst.start();
      window.parent.postMessage({ type: 'canvasviz-state', playing: true }, '*');
      break;
    case 'pause':
      if (inst._running) inst.stop();
      window.parent.postMessage({ type: 'canvasviz-state', playing: false }, '*');
      break;
    case 'restart':
      if (inst._running) inst.stop();
      // Clear canvas
      if (inst.ctx) inst.ctx.clearRect(0, 0, inst.width, inst.height);
      inst.time = 0;
      inst.deltaTime = 0;
      inst._startTime = null;
      inst.start();
      window.parent.postMessage({ type: 'canvasviz-state', playing: true }, '*');
      break;
  }
});
${'<'}/script>
</body>
</html>`;
}

export const CanvasVizBlock: React.FC<CanvasVizBlockProps> = ({ code }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build srcdoc once per code change
  const srcdoc = useMemo(() => buildSrcdoc(code), [code]);

  // Listen for messages from the sandboxed iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from our sandboxed iframe — prevents spoofing
      // from other iframes or windows that could set arbitrary error state.
      if (event.source !== iframeRef.current?.contentWindow) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'canvasviz-ready') {
        if (!data.ok) {
          setError(data.error || 'Unknown error in canvas visualization');
        } else {
          setError(null);
          setPlaying(true);
        }
      }

      if (data.type === 'canvasviz-state') {
        setPlaying(!!data.playing);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Send command to sandboxed iframe.
  // targetOrigin is '*' because sandboxed iframes with `srcdoc` have a `null`
  // origin, making it impossible to specify a concrete target origin.  The
  // iframe sandbox attribute restricts its capabilities instead.
  const sendCommand = useCallback((action: string) => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'canvasviz-cmd', action }, '*');
    }
  }, []);

  const handlePlayPause = useCallback(() => {
    sendCommand(playing ? 'pause' : 'play');
  }, [playing, sendCommand]);

  const handleRestart = useCallback(() => {
    sendCommand('restart');
  }, [sendCommand]);

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono my-4">
        <div className="font-bold mb-1">Canvas Visualization Error</div>
        {error}
      </div>
    );
  }

  return (
    <div className="my-6 rounded-xl bg-[#0a0a0a] border border-zinc-800/50 overflow-hidden shadow-lg transition-all duration-300 hover:border-zinc-700/40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/30 border-b border-zinc-800/20">
        <div className="flex items-center gap-2">
          <Palette size={12} className="text-teal-400" />
          <span className="text-[9px] uppercase text-zinc-500 font-bold tracking-[0.15em]">
            Canvas Visualization
          </span>
        </div>
      </div>

      {/* Canvas viewport — sandboxed iframe */}
      <div className="relative bg-[#0d0d0d]" style={{ width: '100%', maxWidth: WIDTH }}>
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          title="Canvas Visualization"
          className="block w-full border-0"
          style={{ width: '100%', height: HEIGHT }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900/20 border-t border-zinc-800/20">
        <button
          onClick={handlePlayPause}
          className="p-1 rounded-md hover:bg-zinc-700/40 transition-colors"
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <Pause size={14} className="text-zinc-300" />
          ) : (
            <Play size={14} className="text-zinc-300" />
          )}
        </button>

        <button
          onClick={handleRestart}
          className="p-1 rounded-md hover:bg-zinc-700/40 transition-colors"
          title="Restart"
        >
          <RotateCcw size={12} className="text-zinc-500" />
        </button>

        <span className="text-[10px] text-zinc-500 ml-auto">
          Interactive Canvas
        </span>
      </div>
    </div>
  );
};
