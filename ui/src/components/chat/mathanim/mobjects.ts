/**
 * Mobject renderers — draw each mathematical object type onto a Canvas 2D context.
 * 
 * Coordinate system:
 * - Objects with `axesRef` use math coordinates mapped through the axes' transform.
 * - Objects without `axesRef` use pixel coordinates directly.
 */

import type {
  Mobject, AxesMobject, GraphMobject, ParametricMobject,
  VectorMobject, DotMobject, LineMobject, RectMobject,
  CircleMobject, PolygonMobject, TextMobject, BraceMobject,
  AreaMobject, NumberLineMobject, MobjectRenderState,
} from './types';
import { compileExpression } from './math-parser';

// ── Axes coordinate mapping ──────────────────────────────────────────────

export interface AxesTransform {
  /** Pixel position of origin */
  originX: number;
  originY: number;
  /** Pixels per unit in each direction */
  scaleX: number;
  scaleY: number;
  /** Math ranges */
  xRange: [number, number, number];
  yRange: [number, number, number];
}

/**
 * Build a coordinate transform from an AxesMobject definition.
 */
export function buildAxesTransform(axes: AxesMobject, canvasW: number, canvasH: number): AxesTransform {
  const [xMin, xMax] = axes.xRange;
  const [yMin, yMax] = axes.yRange;
  const padding = 50;
  const plotW = canvasW - padding * 2;
  const plotH = canvasH - padding * 2;
  const scaleX = plotW / (xMax - xMin);
  const scaleY = plotH / (yMax - yMin);
  const originX = (axes.position?.[0] ?? (padding + (-xMin) * scaleX));
  const originY = (axes.position?.[1] ?? (canvasH - padding - (-yMin) * scaleY));
  return { originX, originY, scaleX, scaleY, xRange: axes.xRange, yRange: axes.yRange };
}

/**
 * Convert math coordinates to pixel coordinates using an axes transform.
 */
export function mathToPixel(ax: AxesTransform, mx: number, my: number): [number, number] {
  return [
    ax.originX + mx * ax.scaleX,
    ax.originY - my * ax.scaleY,
  ];
}

// ── Drawing helpers ──────────────────────────────────────────────────────

function setStroke(ctx: CanvasRenderingContext2D, color: string, width: number, state: MobjectRenderState) {
  const c = state.colorOverride ?? color;
  ctx.strokeStyle = c;
  ctx.lineWidth = width;
  ctx.globalAlpha = state.opacity;
}

function setFill(ctx: CanvasRenderingContext2D, color: string, state: MobjectRenderState) {
  const c = state.colorOverride ?? color;
  ctx.fillStyle = c;
  ctx.globalAlpha = state.opacity;
}

function applyTransform(ctx: CanvasRenderingContext2D, state: MobjectRenderState, cx: number, cy: number) {
  ctx.translate(cx + state.positionOffset[0], cy + state.positionOffset[1]);
  if (state.rotation !== 0) ctx.rotate(state.rotation);
  if (state.scale !== 1) ctx.scale(state.scale, state.scale);
  ctx.translate(-cx, -cy);
}

/**
 * Apply dashed stroke animation: show only `progress` fraction of the stroke.
 */
function applyStrokeProgress(ctx: CanvasRenderingContext2D, totalLength: number, progress: number) {
  if (progress >= 1) {
    ctx.setLineDash([]);
    return;
  }
  const visible = totalLength * progress;
  ctx.setLineDash([visible, totalLength - visible]);
  ctx.lineDashOffset = 0;
}

// ── Renderers ────────────────────────────────────────────────────────────

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  mob: AxesMobject,
  state: MobjectRenderState,
  canvasW: number,
  canvasH: number,
): void {
  const ax = buildAxesTransform(mob, canvasW, canvasH);
  const color = mob.color ?? '#666666';

  ctx.save();
  applyTransform(ctx, state, ax.originX, ax.originY);

  // Grid
  if (mob.showGrid) {
    setStroke(ctx, color, 0.3, state);
    const [xMin, xMax, xStep] = mob.xRange;
    const [yMin, yMax, yStep] = mob.yRange;
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      if (Math.abs(x) < 0.001) continue;
      const [px] = mathToPixel(ax, x, 0);
      const [, pyTop] = mathToPixel(ax, 0, yMax);
      const [, pyBot] = mathToPixel(ax, 0, yMin);
      ctx.beginPath();
      ctx.moveTo(px, pyTop);
      ctx.lineTo(px, pyBot);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      if (Math.abs(y) < 0.001) continue;
      const [, py] = mathToPixel(ax, 0, y);
      const [pxLeft] = mathToPixel(ax, xMin, 0);
      const [pxRight] = mathToPixel(ax, xMax, 0);
      ctx.beginPath();
      ctx.moveTo(pxLeft, py);
      ctx.lineTo(pxRight, py);
      ctx.stroke();
    }
  }

  // X axis
  const [xMin, xMax, xStep] = mob.xRange;
  const [yMin, yMax, yStep] = mob.yRange;
  setStroke(ctx, color, 1.5, state);

  const totalAxisLen = (xMax - xMin) * ax.scaleX + (yMax - yMin) * ax.scaleY;
  applyStrokeProgress(ctx, totalAxisLen, state.strokeProgress);

  const [xStart] = mathToPixel(ax, xMin, 0);
  const [xEnd] = mathToPixel(ax, xMax, 0);
  const [, yAtZero] = mathToPixel(ax, 0, 0);
  ctx.beginPath();
  ctx.moveTo(xStart, yAtZero);
  ctx.lineTo(xEnd, yAtZero);
  ctx.stroke();

  // Y axis
  const [, yStart] = mathToPixel(ax, 0, yMin);
  const [pxAtZero] = mathToPixel(ax, 0, 0);
  const [, yEnd] = mathToPixel(ax, 0, yMax);
  ctx.beginPath();
  ctx.moveTo(pxAtZero, yStart);
  ctx.lineTo(pxAtZero, yEnd);
  ctx.stroke();

  ctx.setLineDash([]);

  // Tick marks and labels
  setFill(ctx, color, state);
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
    if (Math.abs(x) < 0.001) continue;
    const [px] = mathToPixel(ax, x, 0);
    ctx.beginPath();
    ctx.moveTo(px, yAtZero - 3);
    ctx.lineTo(px, yAtZero + 3);
    ctx.stroke();
    ctx.fillText(String(Math.round(x * 100) / 100), px, yAtZero + 6);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
    if (Math.abs(y) < 0.001) continue;
    const [, py] = mathToPixel(ax, 0, y);
    ctx.beginPath();
    ctx.moveTo(pxAtZero - 3, py);
    ctx.lineTo(pxAtZero + 3, py);
    ctx.stroke();
    ctx.fillText(String(Math.round(y * 100) / 100), pxAtZero - 6, py);
  }

  // Axis labels
  if (mob.xLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'italic 12px sans-serif';
    ctx.fillText(mob.xLabel, xEnd + 15, yAtZero - 5);
  }
  if (mob.yLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'italic 12px sans-serif';
    ctx.fillText(mob.yLabel, pxAtZero + 5, yEnd - 10);
  }

  ctx.restore();
}

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  mob: GraphMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const ax = axesMap.get(mob.axesRef);
  if (!ax) return;

  const fn = compileExpression(mob.fn);
  const color = mob.color ?? '#4ecdc4';
  const sw = mob.strokeWidth ?? 2;
  const [xMin, xMax] = mob.xRange ?? [ax.xRange[0], ax.xRange[1]];
  const steps = 200;
  const dx = (xMax - xMin) / steps;

  ctx.save();
  setStroke(ctx, color, sw, state);

  // Collect points
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * dx;
    const y = fn({ x });
    if (!isFinite(y)) continue;
    points.push(mathToPixel(ax, x, y));
  }

  if (points.length < 2) { ctx.restore(); return; }

  // Calculate total path length for stroke progress
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const ddx = points[i][0] - points[i - 1][0];
    const ddy = points[i][1] - points[i - 1][1];
    totalLen += Math.sqrt(ddx * ddx + ddy * ddy);
  }

  applyStrokeProgress(ctx, totalLen, state.strokeProgress);

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

export function drawParametric(
  ctx: CanvasRenderingContext2D,
  mob: ParametricMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const ax = axesMap.get(mob.axesRef);
  if (!ax) return;

  const fnX = compileExpression(mob.fnX);
  const fnY = compileExpression(mob.fnY);
  const color = mob.color ?? '#ff6b6b';
  const sw = mob.strokeWidth ?? 2;
  const [tMin, tMax] = mob.tRange;
  const steps = 200;
  const dt = (tMax - tMin) / steps;

  ctx.save();
  setStroke(ctx, color, sw, state);

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = tMin + i * dt;
    const x = fnX({ t });
    const y = fnY({ t });
    if (!isFinite(x) || !isFinite(y)) continue;
    points.push(mathToPixel(ax, x, y));
  }

  if (points.length < 2) { ctx.restore(); return; }

  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const ddx = points[i][0] - points[i - 1][0];
    const ddy = points[i][1] - points[i - 1][1];
    totalLen += Math.sqrt(ddx * ddx + ddy * ddy);
  }
  applyStrokeProgress(ctx, totalLen, state.strokeProgress);

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawVector(
  ctx: CanvasRenderingContext2D,
  mob: VectorMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#ffd93d';
  let [fx, fy] = mob.from;
  let [tx, ty] = mob.to;

  if (mob.axesRef) {
    const ax = axesMap.get(mob.axesRef);
    if (ax) {
      [fx, fy] = mathToPixel(ax, mob.from[0], mob.from[1]);
      [tx, ty] = mathToPixel(ax, mob.to[0], mob.to[1]);
    }
  }

  // Apply growArrow via strokeProgress
  const progress = state.strokeProgress;
  const cx = fx + (tx - fx) * progress;
  const cy = fy + (ty - fy) * progress;

  ctx.save();
  setStroke(ctx, color, 2, state);
  setFill(ctx, color, state);

  // Shaft
  ctx.beginPath();
  ctx.moveTo(fx + state.positionOffset[0], fy + state.positionOffset[1]);
  ctx.lineTo(cx + state.positionOffset[0], cy + state.positionOffset[1]);
  ctx.stroke();

  // Arrowhead
  const angle = Math.atan2(cy - fy, cx - fx);
  const headLen = 10;
  ctx.beginPath();
  ctx.moveTo(cx + state.positionOffset[0], cy + state.positionOffset[1]);
  ctx.lineTo(
    cx - headLen * Math.cos(angle - Math.PI / 6) + state.positionOffset[0],
    cy - headLen * Math.sin(angle - Math.PI / 6) + state.positionOffset[1],
  );
  ctx.lineTo(
    cx - headLen * Math.cos(angle + Math.PI / 6) + state.positionOffset[0],
    cy - headLen * Math.sin(angle + Math.PI / 6) + state.positionOffset[1],
  );
  ctx.closePath();
  ctx.fill();

  // Label
  if (mob.label && progress > 0.5) {
    const midX = (fx + cx) / 2 + state.positionOffset[0];
    const midY = (fy + cy) / 2 + state.positionOffset[1] - 12;
    ctx.font = 'italic 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(mob.label, midX, midY);
  }

  ctx.restore();
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  mob: DotMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#ff6b6b';
  const radius = (mob.radius ?? 5) * state.scale;
  let [px, py] = mob.position;

  if (mob.axesRef) {
    const ax = axesMap.get(mob.axesRef);
    if (ax) [px, py] = mathToPixel(ax, mob.position[0], mob.position[1]);
  }

  px += state.positionOffset[0];
  py += state.positionOffset[1];

  ctx.save();
  setFill(ctx, color, state);

  // Indicate flash effect
  if (state.indicateIntensity > 0) {
    ctx.shadowColor = state.colorOverride ?? color;
    ctx.shadowBlur = 20 * state.indicateIntensity;
  }

  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  // Label
  if (mob.label) {
    setFill(ctx, color, state);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(mob.label, px, py - radius - 4);
  }

  ctx.restore();
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  mob: LineMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#ffffff';
  const sw = mob.strokeWidth ?? 2;
  let [fx, fy] = mob.from;
  let [tx, ty] = mob.to;

  if (mob.axesRef) {
    const ax = axesMap.get(mob.axesRef);
    if (ax) {
      [fx, fy] = mathToPixel(ax, mob.from[0], mob.from[1]);
      [tx, ty] = mathToPixel(ax, mob.to[0], mob.to[1]);
    }
  }

  ctx.save();
  setStroke(ctx, color, sw, state);
  if (mob.dashed) ctx.setLineDash([6, 4]);

  const len = Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2);
  applyStrokeProgress(ctx, len, state.strokeProgress);

  ctx.beginPath();
  ctx.moveTo(fx + state.positionOffset[0], fy + state.positionOffset[1]);
  ctx.lineTo(tx + state.positionOffset[0], ty + state.positionOffset[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawRect(
  ctx: CanvasRenderingContext2D,
  mob: RectMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#4ecdc4';
  const fill = mob.fill;
  let [px, py] = mob.position;
  let w = mob.width;
  let h = mob.height;

  if (mob.axesRef) {
    const ax = axesMap.get(mob.axesRef);
    if (ax) {
      [px, py] = mathToPixel(ax, mob.position[0], mob.position[1]);
      w = mob.width * ax.scaleX;
      h = mob.height * ax.scaleY;
    }
  }

  px += state.positionOffset[0];
  py += state.positionOffset[1];

  ctx.save();
  applyTransform(ctx, state, px + w / 2, py + h / 2);

  if (fill) {
    setFill(ctx, fill, state);
    ctx.fillRect(px, py - h, w, h);
  }

  setStroke(ctx, color, 2, state);
  const perimeter = 2 * (w + h);
  applyStrokeProgress(ctx, perimeter, state.strokeProgress);
  ctx.strokeRect(px, py - h, w, h);
  ctx.setLineDash([]);

  // Label
  if (mob.label) {
    setFill(ctx, color, state);
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mob.label, px + w / 2, py - h / 2);
  }

  ctx.restore();
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  mob: CircleMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#ff6b6b';
  const fill = mob.fill;
  let [cx, cy] = mob.center;
  let r = mob.radius;

  if (mob.axesRef) {
    const ax = axesMap.get(mob.axesRef);
    if (ax) {
      [cx, cy] = mathToPixel(ax, mob.center[0], mob.center[1]);
      r = mob.radius * ax.scaleX;
    }
  }

  cx += state.positionOffset[0];
  cy += state.positionOffset[1];

  ctx.save();
  applyTransform(ctx, state, cx, cy);

  if (fill && fill !== 'none') {
    setFill(ctx, fill, state);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  setStroke(ctx, color, 2, state);
  const circumference = 2 * Math.PI * r;
  applyStrokeProgress(ctx, circumference, state.strokeProgress);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  mob: PolygonMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#4ecdc4';
  const fill = mob.fill;
  const ax = mob.axesRef ? axesMap.get(mob.axesRef) : null;

  const pts = mob.points.map(([x, y]) =>
    ax ? mathToPixel(ax, x, y) : [x, y] as [number, number]
  );

  if (pts.length < 2) return;

  // Apply offset
  const offsetPts = pts.map(([x, y]) => [x + state.positionOffset[0], y + state.positionOffset[1]] as [number, number]);

  ctx.save();

  // Compute centroid for transforms
  const centX = offsetPts.reduce((s, p) => s + p[0], 0) / offsetPts.length;
  const centY = offsetPts.reduce((s, p) => s + p[1], 0) / offsetPts.length;
  applyTransform(ctx, state, centX, centY);

  const path = new Path2D();
  path.moveTo(offsetPts[0][0], offsetPts[0][1]);
  for (let i = 1; i < offsetPts.length; i++) {
    path.lineTo(offsetPts[i][0], offsetPts[i][1]);
  }
  path.closePath();

  if (fill) {
    setFill(ctx, fill, state);
    ctx.fill(path);
  }

  setStroke(ctx, color, 2, state);
  // Approximate perimeter for stroke progress
  let perimeter = 0;
  for (let i = 0; i < offsetPts.length; i++) {
    const next = offsetPts[(i + 1) % offsetPts.length];
    perimeter += Math.sqrt((next[0] - offsetPts[i][0]) ** 2 + (next[1] - offsetPts[i][1]) ** 2);
  }
  applyStrokeProgress(ctx, perimeter, state.strokeProgress);
  ctx.stroke(path);
  ctx.setLineDash([]);

  ctx.restore();
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  mob: TextMobject,
  state: MobjectRenderState,
): void {
  const color = mob.color ?? '#cccccc';
  const fontSize = (mob.fontSize ?? 16) * state.scale;
  const [px, py] = [mob.position[0] + state.positionOffset[0], mob.position[1] + state.positionOffset[1]];

  ctx.save();
  setFill(ctx, color, state);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = mob.align ?? 'center';
  ctx.textBaseline = 'middle';

  // Write animation: show characters based on writeProgress
  const text = mob.content;
  const visibleChars = Math.ceil(text.length * state.writeProgress);
  ctx.fillText(text.substring(0, visibleChars), px, py);

  ctx.restore();
}

export function drawBrace(
  ctx: CanvasRenderingContext2D,
  mob: BraceMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
): void {
  const color = mob.color ?? '#ffd93d';
  const ax = mob.axesRef ? axesMap.get(mob.axesRef) : null;

  let [fx, fy] = mob.from;
  let [tx, ty] = mob.to;
  if (ax) {
    [fx, fy] = mathToPixel(ax, mob.from[0], mob.from[1]);
    [tx, ty] = mathToPixel(ax, mob.to[0], mob.to[1]);
  }

  fx += state.positionOffset[0];
  fy += state.positionOffset[1];
  tx += state.positionOffset[0];
  ty += state.positionOffset[1];

  const dir = mob.direction ?? 'down';
  const offset = 15;
  const midX = (fx + tx) / 2;
  const midY = (fy + ty) / 2;

  ctx.save();
  setStroke(ctx, color, 1.5, state);
  setFill(ctx, color, state);

  let bx1: number, by1: number, bx2: number, by2: number, tipX: number, tipY: number;

  if (dir === 'down' || dir === 'up') {
    const sign = dir === 'down' ? 1 : -1;
    bx1 = fx; by1 = fy + sign * offset;
    bx2 = tx; by2 = ty + sign * offset;
    tipX = midX; tipY = midY + sign * offset * 2;
  } else {
    const sign = dir === 'right' ? 1 : -1;
    bx1 = fx + sign * offset; by1 = fy;
    bx2 = tx + sign * offset; by2 = ty;
    tipX = midX + sign * offset * 2; tipY = midY;
  }

  // Draw brace with curves
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(bx1, by1, tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.quadraticCurveTo(bx2, by2, tipX, tipY);
  ctx.stroke();

  // Label
  if (mob.label) {
    const labelOffset = dir === 'down' ? 14 : dir === 'up' ? -14 : dir === 'right' ? 14 : -14;
    ctx.font = 'italic 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (dir === 'down' || dir === 'up') {
      ctx.fillText(mob.label, tipX, tipY + labelOffset);
    } else {
      ctx.fillText(mob.label, tipX + labelOffset, tipY);
    }
  }

  ctx.restore();
}

export function drawArea(
  ctx: CanvasRenderingContext2D,
  mob: AreaMobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
  objects: Mobject[],
): void {
  const ax = axesMap.get(mob.axesRef);
  if (!ax) return;

  // Find the referenced graph
  const graphMob = objects.find(o => o.id === mob.graphRef) as GraphMobject | undefined;
  if (!graphMob) return;

  const fn = compileExpression(graphMob.fn);
  const fill = mob.fill ?? '#4ecdc420';
  const [xMin, xMax] = mob.xRange;
  const steps = 100;
  const dx = (xMax - xMin) / steps;

  ctx.save();
  setFill(ctx, fill, state);

  const [startPx, basePy] = mathToPixel(ax, xMin, 0);
  ctx.beginPath();
  ctx.moveTo(startPx, basePy);

  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * dx;
    const y = fn({ x });
    if (!isFinite(y)) continue;
    const [px, py] = mathToPixel(ax, x, y);
    ctx.lineTo(px, py);
  }

  const [endPx] = mathToPixel(ax, xMax, 0);
  ctx.lineTo(endPx, basePy);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export function drawNumberLine(
  ctx: CanvasRenderingContext2D,
  mob: NumberLineMobject,
  state: MobjectRenderState,
): void {
  const color = mob.color ?? '#888888';
  const [px, py] = [mob.position[0] + state.positionOffset[0], mob.position[1] + state.positionOffset[1]];
  const [rangeMin, rangeMax, step] = mob.range;
  const len = mob.length;
  const pxPerUnit = len / (rangeMax - rangeMin);

  ctx.save();
  setStroke(ctx, color, 2, state);

  const startX = px - len / 2;
  const endX = px + len / 2;

  applyStrokeProgress(ctx, len, state.strokeProgress);
  ctx.beginPath();
  ctx.moveTo(startX, py);
  ctx.lineTo(endX, py);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ticks and labels
  setFill(ctx, color, state);
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let v = rangeMin; v <= rangeMax; v += step) {
    const tx = startX + (v - rangeMin) * pxPerUnit;
    ctx.beginPath();
    ctx.moveTo(tx, py - 4);
    ctx.lineTo(tx, py + 4);
    ctx.stroke();
    ctx.fillText(String(Math.round(v * 100) / 100), tx, py + 7);
  }

  // Highlights
  if (mob.highlights) {
    for (const hl of mob.highlights) {
      const hx = startX + (hl.value - rangeMin) * pxPerUnit;
      setFill(ctx, hl.color, state);
      ctx.beginPath();
      ctx.arc(hx, py, 5, 0, Math.PI * 2);
      ctx.fill();
      if (hl.label) {
        ctx.font = 'italic 12px sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(hl.label, hx, py - 8);
      }
    }
  }

  ctx.restore();
}

// ── Master dispatch ──────────────────────────────────────────────────────

/**
 * Returns true if this mobject type is rendered as an HTML overlay (LaTeX).
 * These are NOT drawn on canvas.
 */
export function isOverlayMobject(mob: Mobject): boolean {
  return mob.type === 'latex';
}

/**
 * Draw a single mobject on the canvas. Skips overlay types (latex).
 */
export function drawMobject(
  ctx: CanvasRenderingContext2D,
  mob: Mobject,
  state: MobjectRenderState,
  axesMap: Map<string, AxesTransform>,
  canvasW: number,
  canvasH: number,
  allObjects: Mobject[],
): void {
  if (state.opacity <= 0.001) return;
  if (isOverlayMobject(mob)) return;

  switch (mob.type) {
    case 'axes': drawAxes(ctx, mob, state, canvasW, canvasH); break;
    case 'graph': drawGraph(ctx, mob, state, axesMap); break;
    case 'parametric': drawParametric(ctx, mob, state, axesMap); break;
    case 'vector': drawVector(ctx, mob, state, axesMap); break;
    case 'dot': drawDot(ctx, mob, state, axesMap); break;
    case 'line': drawLine(ctx, mob, state, axesMap); break;
    case 'rect': drawRect(ctx, mob, state, axesMap); break;
    case 'circle': drawCircle(ctx, mob, state, axesMap); break;
    case 'polygon': drawPolygon(ctx, mob, state, axesMap); break;
    case 'text': drawText(ctx, mob, state); break;
    case 'brace': drawBrace(ctx, mob, state, axesMap); break;
    case 'area': drawArea(ctx, mob, state, axesMap, allObjects); break;
    case 'numberLine': drawNumberLine(ctx, mob, state); break;
  }
}
