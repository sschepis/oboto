/**
 * MathAnimBlock — React component that renders a mathanim code fence
 * as an interactive animated mathematical visualization.
 *
 * Two-layer rendering:
 * 1. Canvas (bottom) — geometric primitives, graphs, axes, shapes
 * 2. KaTeX overlay (top) — LaTeX expressions positioned over canvas
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import katex from 'katex';
import { MathAnimEngine, type LaTeXOverlay } from './mathanim/MathAnimEngine';
import type { MathAnimConfig } from './mathanim/types';
import { Play, Pause, RotateCcw, Activity } from 'lucide-react';

interface MathAnimBlockProps {
  code: string;
}

// ── LaTeX overlay component ──────────────────────────────────────────────

/** Overlay positions are expressed as percentages of the canvas dimensions so
 *  they stay aligned when the canvas is CSS-scaled via `w-full`. */
interface NormalizedLaTeXOverlay extends LaTeXOverlay {
  /** x position as a percentage of canvas width (0–100) */
  xPct: number;
  /** y position as a percentage of canvas height (0–100) */
  yPct: number;
}

function LaTeXNode({ overlay }: { overlay: NormalizedLaTeXOverlay }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      // For write animation, show partial expression
      const expr = overlay.writeProgress < 1
        ? overlay.expression.slice(0, Math.ceil(overlay.expression.length * overlay.writeProgress))
        : overlay.expression;

      katex.render(expr, ref.current, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      if (ref.current) {
        ref.current.textContent = overlay.expression;
      }
    }
  }, [overlay.expression, overlay.writeProgress]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: `${overlay.xPct}%`,
        top: `${overlay.yPct}%`,
        fontSize: overlay.fontSize,
        color: overlay.color,
        opacity: overlay.opacity,
        transform: `translate(-50%, -50%) scale(${overlay.scale})`,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    />
  );
}

// ── Time formatting ──────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Main component ───────────────────────────────────────────────────────

export const MathAnimBlock: React.FC<MathAnimBlockProps> = ({ code }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MathAnimEngine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [latexOverlays, setLatexOverlays] = useState<LaTeXOverlay[]>([]);
  const [speed, setSpeed] = useState(1);

  // Parse config
  const config: MathAnimConfig | null = useMemo(() => {
    try {
      return JSON.parse(code);
    } catch (e) {
      console.error('Failed to parse mathanim config:', e);
      return null;
    }
  }, [code]);

  const width = config?.width ?? 600;
  const height = config?.height ?? 400;
  const totalDuration = useMemo(() => {
    if (!config) return 0;
    return config.duration ?? config.scenes.reduce((sum, s) => sum + (s.duration ?? 5), 0);
  }, [config]);

  // Initialize engine
  useEffect(() => {
    if (!canvasRef.current || !config) return;

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;

    const engine = new MathAnimEngine(canvas, config);
    engine.setLatexCallback(setLatexOverlays);
    engineRef.current = engine;

    // Render first frame
    engine.renderFrame();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [config, width, height]);

  // Sync playing state
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (playing) {
      engine.play();
    } else {
      engine.pause();
    }
  }, [playing]);

  // Update time display during playback
  useEffect(() => {
    if (!playing) return;

    const interval = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setCurrentTime(engine.currentTime);
      if (!engine.playing) {
        setPlaying(false);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [playing]);

  // Sync speed
  useEffect(() => {
    engineRef.current?.setSpeed(speed);
  }, [speed]);

  // Handlers
  const handlePlayPause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    // If at the end, restart
    if (!playing && engine.currentTime >= totalDuration) {
      engine.restart();
      setCurrentTime(0);
    }

    setPlaying(prev => !prev);
  }, [playing, totalDuration]);

  const handleRestart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.restart();
    setCurrentTime(0);
    setPlaying(false);
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    engineRef.current?.seek(time);
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed(prev => {
      const speeds = [0.5, 1, 1.5, 2];
      const idx = speeds.indexOf(prev);
      return speeds[(idx + 1) % speeds.length];
    });
  }, []);

  // Error state
  if (!config) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono my-4">
        Invalid math animation configuration — could not parse JSON
      </div>
    );
  }

  return (
    <div className="my-6 rounded-xl bg-[#0a0a0a] border border-zinc-800/50 overflow-hidden shadow-lg transition-all duration-300 hover:border-zinc-700/40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/30 border-b border-zinc-800/20">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-indigo-400" />
          <span className="text-[9px] uppercase text-zinc-500 font-bold tracking-[0.15em]">
            Math Animation
          </span>
          {config.title && (
            <span className="text-xs text-zinc-400 ml-1">— {config.title}</span>
          )}
        </div>
      </div>

      {/* Animation viewport */}
      <div className="relative" style={{ width: '100%', maxWidth: width }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block w-full"
          style={{ aspectRatio: `${width} / ${height}` }}
        />

        {/* LaTeX overlay layer — uses percentage positioning so it stays
            aligned when the canvas is CSS-scaled via w-full / aspectRatio */}
        <div className="absolute inset-0 pointer-events-none w-full h-full">
          {latexOverlays.map(ol => (
            <LaTeXNode
              key={ol.id}
              overlay={{
                ...ol,
                xPct: (ol.x / width) * 100,
                yPct: (ol.y / height) * 100,
              }}
            />
          ))}
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900/20 border-t border-zinc-800/20">
        {/* Play/Pause */}
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

        {/* Restart */}
        <button
          onClick={handleRestart}
          className="p-1 rounded-md hover:bg-zinc-700/40 transition-colors"
          title="Restart"
        >
          <RotateCcw size={12} className="text-zinc-500" />
        </button>

        {/* Timeline scrubber */}
        <input
          type="range"
          min={0}
          max={totalDuration}
          step={0.05}
          value={currentTime}
          onChange={handleSeek}
          className="flex-1 h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:bg-indigo-400
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:cursor-pointer
          "
        />

        {/* Time display */}
        <span className="text-[10px] text-zinc-500 font-mono tabular-nums min-w-[70px] text-right">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>

        {/* Speed toggle */}
        <button
          onClick={cycleSpeed}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40 transition-colors min-w-[32px]"
          title="Playback speed"
        >
          {speed}x
        </button>
      </div>
    </div>
  );
};
