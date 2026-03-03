/**
 * Type definitions for the mathanim DSL — a Manim-inspired declarative JSON
 * schema for animated mathematical visualizations.
 */

// ── Easing ───────────────────────────────────────────────────────────────

export type EasingName =
  | 'linear'
  | 'easeIn' | 'easeOut' | 'easeInOut'
  | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInBack' | 'easeOutBack' | 'easeInOutBack';

// ── Mobject types ────────────────────────────────────────────────────────

export interface MobjectBase {
  id: string;
  type: string;
  /** Initial opacity — defaults to 1; set to 0 for objects that fadeIn */
  opacity?: number;
}

export interface AxesMobject extends MobjectBase {
  type: 'axes';
  /** [min, max, step] */
  xRange: [number, number, number];
  yRange: [number, number, number];
  xLabel?: string;
  yLabel?: string;
  color?: string;
  showGrid?: boolean;
  /** Pixel position of the origin [x, y] */
  position?: [number, number];
}

export interface GraphMobject extends MobjectBase {
  type: 'graph';
  axesRef: string;
  /** Math expression string e.g. "x^2", "sin(x)" */
  fn: string;
  /** [min, max] — defaults to axes xRange */
  xRange?: [number, number];
  color?: string;
  strokeWidth?: number;
}

export interface ParametricMobject extends MobjectBase {
  type: 'parametric';
  axesRef: string;
  fnX: string;
  fnY: string;
  /** [min, max] for parameter t */
  tRange: [number, number];
  color?: string;
  strokeWidth?: number;
}

export interface VectorMobject extends MobjectBase {
  type: 'vector';
  from: [number, number];
  to: [number, number];
  color?: string;
  label?: string;
  axesRef?: string;
}

export interface DotMobject extends MobjectBase {
  type: 'dot';
  position: [number, number];
  radius?: number;
  color?: string;
  label?: string;
  axesRef?: string;
}

export interface LineMobject extends MobjectBase {
  type: 'line';
  from: [number, number];
  to: [number, number];
  color?: string;
  strokeWidth?: number;
  dashed?: boolean;
  axesRef?: string;
}

export interface RectMobject extends MobjectBase {
  type: 'rect';
  position: [number, number];
  width: number;
  height: number;
  color?: string;
  fill?: string;
  label?: string;
  axesRef?: string;
}

export interface CircleMobject extends MobjectBase {
  type: 'circle';
  center: [number, number];
  radius: number;
  color?: string;
  fill?: string;
  axesRef?: string;
}

export interface PolygonMobject extends MobjectBase {
  type: 'polygon';
  points: [number, number][];
  color?: string;
  fill?: string;
  axesRef?: string;
}

export interface LatexMobject extends MobjectBase {
  type: 'latex';
  expression: string;
  position: [number, number];
  fontSize?: number;
  color?: string;
}

export interface TextMobject extends MobjectBase {
  type: 'text';
  content: string;
  position: [number, number];
  fontSize?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface BraceMobject extends MobjectBase {
  type: 'brace';
  from: [number, number];
  to: [number, number];
  label?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  color?: string;
  axesRef?: string;
}

export interface AreaMobject extends MobjectBase {
  type: 'area';
  graphRef: string;
  xRange: [number, number];
  fill?: string;
  axesRef: string;
}

export interface NumberLineHighlight {
  value: number;
  color: string;
  label?: string;
}

export interface NumberLineMobject extends MobjectBase {
  type: 'numberLine';
  /** [min, max, step] */
  range: [number, number, number];
  position: [number, number];
  length: number;
  color?: string;
  highlights?: NumberLineHighlight[];
}

export type Mobject =
  | AxesMobject
  | GraphMobject
  | ParametricMobject
  | VectorMobject
  | DotMobject
  | LineMobject
  | RectMobject
  | CircleMobject
  | PolygonMobject
  | LatexMobject
  | TextMobject
  | BraceMobject
  | AreaMobject
  | NumberLineMobject;

// ── Animation types ──────────────────────────────────────────────────────

export interface AnimationBase {
  type: string;
  target: string;
  startTime: number;
  duration: number;
  easing?: EasingName;
}

export interface FadeInAnimation extends AnimationBase { type: 'fadeIn'; }
export interface FadeOutAnimation extends AnimationBase { type: 'fadeOut'; }
export interface CreateAnimation extends AnimationBase { type: 'create'; }
export interface ShowCreationAnimation extends AnimationBase { type: 'showCreation'; }
export interface UncreateAnimation extends AnimationBase { type: 'uncreate'; }
export interface WriteAnimation extends AnimationBase { type: 'write'; }
export interface TraceGraphAnimation extends AnimationBase { type: 'traceGraph'; }
export interface GrowArrowAnimation extends AnimationBase { type: 'growArrow'; }

export interface TransformAnimation extends AnimationBase {
  type: 'transform';
  to: string; // target object id to morph into
}

export interface MoveToAnimation extends AnimationBase {
  type: 'moveTo';
  position: [number, number];
}

export interface ScaleAnimation extends AnimationBase {
  type: 'scale';
  factor: number;
}

export interface RotateAnimation extends AnimationBase {
  type: 'rotate';
  angle: number;
}

export interface IndicateAnimation extends AnimationBase {
  type: 'indicate';
  color?: string;
}

export interface CircumscribeAnimation extends AnimationBase {
  type: 'circumscribe';
  shape?: 'circle' | 'rect';
}

export interface ShiftInAnimation extends AnimationBase {
  type: 'shiftIn';
  direction?: 'left' | 'right' | 'up' | 'down';
}

export interface ColorChangeAnimation extends AnimationBase {
  type: 'colorChange';
  color: string;
}

export interface TraceDotAnimation extends AnimationBase {
  type: 'traceDot';
  graphRef: string;
  tRange?: [number, number];
}

export type Animation =
  | FadeInAnimation
  | FadeOutAnimation
  | CreateAnimation
  | ShowCreationAnimation
  | UncreateAnimation
  | WriteAnimation
  | TraceGraphAnimation
  | GrowArrowAnimation
  | TransformAnimation
  | MoveToAnimation
  | ScaleAnimation
  | RotateAnimation
  | IndicateAnimation
  | CircumscribeAnimation
  | ShiftInAnimation
  | ColorChangeAnimation
  | TraceDotAnimation;

// ── Scene & Config ───────────────────────────────────────────────────────

export interface Scene {
  id: string;
  objects: Mobject[];
  animations: Animation[];
  duration: number;
}

export interface MathAnimConfig {
  title?: string;
  width?: number;
  height?: number;
  background?: string;
  duration?: number;
  scenes: Scene[];
}

// ── Runtime state ────────────────────────────────────────────────────────

export interface MobjectRenderState {
  opacity: number;
  /** For stroke-based create/traceGraph: 0..1 progress */
  strokeProgress: number;
  /** For write: 0..1 character reveal progress */
  writeProgress: number;
  /** Scale multiplier */
  scale: number;
  /** Rotation in radians */
  rotation: number;
  /** Position offset [dx, dy] in pixels */
  positionOffset: [number, number];
  /** Color override (for colorChange / indicate) */
  colorOverride: string | null;
  /** Indicate flash intensity 0..1 */
  indicateIntensity: number;
}

export function createDefaultRenderState(mob: Mobject): MobjectRenderState {
  return {
    opacity: mob.opacity ?? 1,
    strokeProgress: 1,
    writeProgress: 1,
    scale: 1,
    rotation: 0,
    positionOffset: [0, 0],
    colorOverride: null,
    indicateIntensity: 0,
  };
}
