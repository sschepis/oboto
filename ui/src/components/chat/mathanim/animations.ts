/**
 * Animation controllers — given an animation config and progress t ∈ [0,1],
 * modify the MobjectRenderState accordingly.
 */

import type { Animation, MobjectRenderState } from './types';

/**
 * Apply an animation at progress t to the given render state.
 * Returns a modified copy of the state.
 */
export function applyAnimation(
  anim: Animation,
  t: number,
  state: MobjectRenderState,
): MobjectRenderState {
  const s = { ...state };

  switch (anim.type) {
    case 'fadeIn':
      s.opacity = t;
      break;

    case 'fadeOut':
      s.opacity = 1 - t;
      break;

    case 'create':
    case 'showCreation':
      // Progressive stroke drawing
      s.strokeProgress = t;
      // Also fade in slightly for smooth appearance
      s.opacity = Math.min(1, t * 3);
      break;

    case 'uncreate':
      s.strokeProgress = 1 - t;
      s.opacity = Math.max(0, 1 - t * 1.5);
      break;

    case 'write':
      s.writeProgress = t;
      s.opacity = Math.min(1, t * 5);
      break;

    case 'traceGraph':
      s.strokeProgress = t;
      s.opacity = Math.min(1, t * 5);
      break;

    case 'growArrow':
      s.strokeProgress = t;
      s.opacity = Math.min(1, t * 5);
      break;

    case 'moveTo':
      if (anim.type === 'moveTo') {
        // positionOffset is interpolated from [0,0] toward a delta
        // The actual delta is computed in the engine since it needs the
        // original position. Here we store the interpolation factor.
        s.positionOffset = [
          anim.position[0] * t,
          anim.position[1] * t,
        ];
      }
      break;

    case 'scale':
      if (anim.type === 'scale') {
        // Interpolate from 1 to target factor
        s.scale = 1 + (anim.factor - 1) * t;
      }
      break;

    case 'rotate':
      if (anim.type === 'rotate') {
        s.rotation = anim.angle * t;
      }
      break;

    case 'indicate':
      // Pulse effect: rises then falls
      if (anim.type === 'indicate') {
        const pulse = t < 0.5 ? t * 2 : (1 - t) * 2;
        s.indicateIntensity = pulse;
        if (anim.color) {
          s.colorOverride = anim.color;
        }
        // Scale pulse
        s.scale = 1 + 0.15 * pulse;
      }
      break;

    case 'circumscribe':
      // Just a flash with optional scale
      {
        const pulse = t < 0.5 ? t * 2 : (1 - t) * 2;
        s.indicateIntensity = pulse;
        s.scale = 1 + 0.1 * pulse;
      }
      break;

    case 'shiftIn':
      if (anim.type === 'shiftIn') {
        const dir = anim.direction ?? 'left';
        const dist = 100; // pixels to slide in from
        const remaining = 1 - t;
        switch (dir) {
          case 'left':  s.positionOffset = [-dist * remaining, 0]; break;
          case 'right': s.positionOffset = [dist * remaining, 0]; break;
          case 'up':    s.positionOffset = [0, -dist * remaining]; break;
          case 'down':  s.positionOffset = [0, dist * remaining]; break;
        }
        s.opacity = t;
      }
      break;

    case 'colorChange':
      if (anim.type === 'colorChange') {
        // Set color override — the actual interpolation is done by blending
        // For simplicity we switch to the target color immediately and use
        // opacity to smooth the transition
        s.colorOverride = anim.color;
      }
      break;

    case 'traceDot':
      // This is handled specially in the engine — it creates a temporary dot
      // that follows a graph path. The state modification here just controls
      // visibility via strokeProgress.
      s.strokeProgress = t;
      s.opacity = t > 0 ? 1 : 0;
      break;

    case 'transform':
      // Transform is complex — morph between two object states.
      // For now we handle it as a crossfade: fade out old, fade in new.
      // The engine handles the counterpart on the target object.
      s.opacity = 1 - t;
      break;
  }

  return s;
}

/**
 * For objects that haven't been animated yet (before their first animation starts),
 * determine what their initial render state should be.
 * 
 * Objects targeted by fadeIn/create/write/traceGraph/growArrow/shiftIn start invisible.
 * Others start fully visible.
 */
export function getPreAnimationState(
  anims: Animation[],
  objectId: string,
  state: MobjectRenderState,
): MobjectRenderState {
  // Find the first animation targeting this object
  const firstAnim = anims
    .filter(a => a.target === objectId)
    .sort((a, b) => a.startTime - b.startTime)[0];

  if (!firstAnim) return state;

  const s = { ...state };

  switch (firstAnim.type) {
    case 'fadeIn':
    case 'shiftIn':
      s.opacity = 0;
      break;
    case 'create':
    case 'showCreation':
      s.opacity = 0;
      s.strokeProgress = 0;
      break;
    case 'write':
      s.opacity = 0;
      s.writeProgress = 0;
      break;
    case 'traceGraph':
      s.opacity = 0;
      s.strokeProgress = 0;
      break;
    case 'growArrow':
      s.opacity = 0;
      s.strokeProgress = 0;
      break;
  }

  return s;
}
