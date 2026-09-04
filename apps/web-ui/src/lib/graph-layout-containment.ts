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

/** Keep node velocity inside radius border; damp speed by overshoot. */
export function containedVelocity(
  point: Point,
  velocity: { vx: number; vy: number },
  { center, radius }: { center: Point; radius: number },
  options?: ContainmentOptions,
): { vx: number; vy: number } {
  const { returnPull, maxReturn, dampScale, epsilon } =
    resolveContainment(options);
  let vx = velocity.vx;
  let vy = velocity.vy;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.hypot(dx, dy);

  if (dist > radius && dist > 0) {
    const contained = containOverflowVelocity(
      { vx, vy },
      { ux: dx / dist, uy: dy / dist },
      dist - radius,
      { returnPull, maxReturn, dampScale },
    );

    vx = contained.vx;
    vy = contained.vy;
  }

  if (Math.abs(vx) < epsilon) {
    vx = 0;
  }

  if (Math.abs(vy) < epsilon) {
    vy = 0;
  }

  return { vx, vy };
}
