// Keeping simulated node velocity inside a bounding radius, with eased return.

import type { Point } from "./graph-layout";

export interface ContainmentOptions {
  /** Inward return speed per pixel of overshoot, capped at `maxReturn`. */
  returnPull?: number;
  /** Ceiling on the inward return speed, so a far node eases in, not snaps. */
  maxReturn?: number;
  /** Overshoot at which velocity is roughly halved — the "slower the further" knob. */
  dampScale?: number;
  /** Velocities with smaller magnitude than this are flattened to 0. */
  epsilon?: number;
}

/** Overshoot correction: cancel outward, ease back in with capped pull. */
function containOverflowVelocity(
  velocity: { vx: number; vy: number },
  unit: { ux: number; uy: number },
  over: number,
  knobs: { returnPull: number; maxReturn: number; dampScale: number },
): { vx: number; vy: number } {
  let vx = velocity.vx;
  let vy = velocity.vy;
  const outward = vx * unit.ux + vy * unit.uy;

  if (outward > 0) {
    vx -= outward * unit.ux;
    vy -= outward * unit.uy;
  }
  const ret = Math.min(knobs.maxReturn, over * knobs.returnPull);

  vx -= ret * unit.ux;
  vy -= ret * unit.uy;
  const damp = 1 / (1 + over / knobs.dampScale);

  return { vx: vx * damp, vy: vy * damp };
}

const DEFAULT_CONTAINMENT: Required<ContainmentOptions> = {
  returnPull: 0.1,
  maxReturn: 6,
  dampScale: 300,
  epsilon: 1e-3,
};

function resolveContainment(
  opts: ContainmentOptions = {},
): Required<ContainmentOptions> {
  return { ...DEFAULT_CONTAINMENT, ...opts };
}

/** Zeroes a velocity that is merely drifting. Without this the simulation never settles — a node keeps jittering by amounts too small to see but large enough to keep re-rendering. */
function atRest(
  { vx, vy }: { vx: number; vy: number },
  epsilon: number,
): { vx: number; vy: number } {
  return {
    vx: Math.abs(vx) < epsilon ? 0 : vx,
    vy: Math.abs(vy) < epsilon ? 0 : vy,
  };
}

/** Keep node velocity inside radius border; damp speed by overshoot. */
export function containedVelocity(
  point: Point,
  velocity: { vx: number; vy: number },
  bound: { center: Point; radius: number },
  options?: ContainmentOptions,
): { vx: number; vy: number } {
  const knobs = resolveContainment(options);

  return atRest(containBound(point, velocity, bound, knobs), knobs.epsilon);
}

/** Velocity with any outward component past the radius cancelled and damped. */
function containBound(
  point: Point,
  velocity: { vx: number; vy: number },
  { center, radius }: { center: Point; radius: number },
  knobs: Required<ContainmentOptions>,
): { vx: number; vy: number } {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= radius || dist === 0) {
    return velocity;
  }

  return containOverflowVelocity(
    velocity,
    { ux: dx / dist, uy: dy / dist },
    dist - radius,
    knobs,
  );
}
