/**
 * MathAnimEngine — core animation engine for the mathanim DSL.
 *
 * Manages the scene graph, timeline, and render loop.
 * Renders geometric primitives on an HTML5 Canvas and positions
 * KaTeX LaTeX overlays via a callback.
 */

import type {
  MathAnimConfig, Scene,
  MobjectRenderState, AxesMobject, LatexMobject,
} from './types';
import { createDefaultRenderState } from './types';
import { getEasing, clamp } from './easing';
import { applyAnimation, getPreAnimationState } from './animations';
import { drawMobject, isOverlayMobject, buildAxesTransform, type AxesTransform } from './mobjects';

// ── LaTeX overlay info ───────────────────────────────────────────────────

export interface LaTeXOverlay {
  id: string;
  expression: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  opacity: number;
  scale: number;
  /** For write animation: how many characters to show (as a fraction of expression length) */
  writeProgress: number;
}

// ── Engine ───────────────────────────────────────────────────────────────

export class MathAnimEngine {
  private config: MathAnimConfig;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;

  // Playback state
  private _currentTime = 0;
  private _playing = false;
  private _speed = 1;
  private _totalDuration = 0;

  /** Absolute timestamp anchor — time accumulated before the last speed change
   *  or seek. Combined with `_speedAnchor` to compute `_currentTime` without
   *  incremental floating-point drift. */
  private _baseTime = 0;
  /** The `performance.now()` value at the last anchor point (play/seek/speed change). */
  private _speedAnchor: number | null = null;

  // Callback to update LaTeX overlays in React
  private onLatexUpdate: ((overlays: LaTeXOverlay[]) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, config: MathAnimConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas 2d context');
    this.ctx = ctx;
    this.config = config;

    // Calculate total duration
    this._totalDuration = config.duration ?? config.scenes.reduce((sum, s) => sum + (s.duration ?? 5), 0);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  get currentTime(): number { return this._currentTime; }
  get totalDuration(): number { return this._totalDuration; }
  get playing(): boolean { return this._playing; }
  get speed(): number { return this._speed; }

  setLatexCallback(cb: (overlays: LaTeXOverlay[]) => void): void {
    this.onLatexUpdate = cb;
  }

  play(): void {
    if (this._playing) return;
    this._playing = true;
    // Anchor so elapsed time is computed absolutely from this point.
    this._baseTime = this._currentTime;
    this._speedAnchor = null;
    this.loop();
  }

  pause(): void {
    this._playing = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  seek(time: number): void {
    this._currentTime = clamp(time, 0, this._totalDuration);
    this._baseTime = this._currentTime;
    this._speedAnchor = null;
    this.renderFrame();
  }

  setSpeed(speed: number): void {
    // Snapshot the current playback position before changing speed so the
    // absolute-time formula stays correct.
    this._baseTime = this._currentTime;
    this._speedAnchor = null;
    this._speed = speed;
  }

  restart(): void {
    this._currentTime = 0;
    this._baseTime = 0;
    this._speedAnchor = null;
    if (!this._playing) {
      this.renderFrame();
    }
  }

  destroy(): void {
    this.pause();
    this.onLatexUpdate = null;
  }

  /**
   * Render a single frame at the current time. Called automatically during
   * playback or manually via seek().
   */
  renderFrame(): void {
    const { ctx, canvas, config } = this;
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = config.background ?? '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Find active scene
    let sceneStartTime = 0;
    let activeScene: Scene | null = null;
    let sceneLocalTime = 0;

    for (const scene of config.scenes) {
      const dur = scene.duration ?? 5;
      if (this._currentTime >= sceneStartTime && this._currentTime < sceneStartTime + dur) {
        activeScene = scene;
        sceneLocalTime = this._currentTime - sceneStartTime;
        break;
      }
      sceneStartTime += dur;
    }

    // If past all scenes, show last scene's final state
    if (!activeScene && config.scenes.length > 0) {
      activeScene = config.scenes[config.scenes.length - 1];
      sceneLocalTime = activeScene.duration ?? 5;
    }

    if (!activeScene) return;

    // Build axes transforms
    const axesMap = new Map<string, AxesTransform>();
    for (const obj of activeScene.objects) {
      if (obj.type === 'axes') {
        axesMap.set(obj.id, buildAxesTransform(obj as AxesMobject, w, h));
      }
    }

    // Compute render states for all objects
    const states = new Map<string, MobjectRenderState>();
    const latexOverlays: LaTeXOverlay[] = [];

    for (const obj of activeScene.objects) {
      // Start with default state
      let state = createDefaultRenderState(obj);

      // Apply pre-animation state (objects targeted by fadeIn etc. start invisible)
      state = getPreAnimationState(activeScene.animations, obj.id, state);

      // Apply all active animations
      for (const anim of activeScene.animations) {
        if (anim.target !== obj.id) continue;

        const animEnd = anim.startTime + anim.duration;
        if (sceneLocalTime < anim.startTime) continue; // animation hasn't started
        if (sceneLocalTime >= animEnd) {
          // Animation completed — apply at t=1
          state = applyAnimation(anim, 1, state);
          continue;
        }

        // Animation in progress
        const rawT = (sceneLocalTime - anim.startTime) / anim.duration;
        const easingFn = getEasing(anim.easing);
        const t = easingFn(clamp(rawT));
        state = applyAnimation(anim, t, state);
      }

      states.set(obj.id, state);

      // Collect LaTeX overlays — prefix id with scene id to prevent React key
      // collisions when different scenes define objects with the same id.
      if (isOverlayMobject(obj) && obj.type === 'latex') {
        const latexMob = obj as LatexMobject;
        latexOverlays.push({
          id: `${activeScene.id}:${latexMob.id}`,
          expression: latexMob.expression,
          x: latexMob.position[0] + state.positionOffset[0],
          y: latexMob.position[1] + state.positionOffset[1],
          fontSize: (latexMob.fontSize ?? 20) * state.scale,
          color: state.colorOverride ?? latexMob.color ?? '#ffffff',
          opacity: state.opacity,
          scale: state.scale,
          writeProgress: state.writeProgress,
        });
      }
    }

    // Draw all canvas objects (in order — order matters for layering)
    for (const obj of activeScene.objects) {
      const state = states.get(obj.id);
      if (!state) continue;
      drawMobject(ctx, obj, state, axesMap, w, h, activeScene.objects);
    }

    // Reset global alpha
    ctx.globalAlpha = 1;

    // Update LaTeX overlays
    if (this.onLatexUpdate) {
      this.onLatexUpdate(latexOverlays);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────

  private loop = (): void => {
    if (!this._playing) return;

    this.rafId = requestAnimationFrame((timestamp) => {
      // On the first frame after play/seek/speed-change, anchor the timestamp.
      if (this._speedAnchor === null) {
        this._speedAnchor = timestamp;
      }

      // Compute current time from the absolute anchor — no incremental drift.
      this._currentTime = this._baseTime + (timestamp - this._speedAnchor) / 1000 * this._speed;

      // Stop at end
      if (this._currentTime >= this._totalDuration) {
        this._currentTime = this._totalDuration;
        this.renderFrame();
        this._playing = false;
        return;
      }

      this.renderFrame();
      this.loop();
    });
  };
}
