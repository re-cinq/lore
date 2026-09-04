// Radial-tree seed positions: depth maps to radius, leaves spread evenly by angle.

import type { Point } from "./graph-layout";

export interface RadialTreeOptions {
  center: Point;
  /** Radius added per hierarchy level — depth 0 (root) sits at the centre. */
  ringGap: number;
  /** Angular wedge the tree fills (defaults to a full circle). */
  angleStart?: number;
  angleEnd?: number;
}

function resolveAngleRange(opts: RadialTreeOptions): {
  angleStart: number;
  angleEnd: number;
} {
  return {
    angleStart: opts.angleStart ?? 0,
    angleEnd: opts.angleEnd ?? Math.PI * 2,
  };
}

/** Fills in each non-leaf's angle as the mean of its children's (post-order guarantees they're set). */
function fillParentAngles(
  postOrder: string[],
  childrenOf: Map<string, string[]>,
  angle: Map<string, number>,
  angleStart: number,
): void {
  for (const id of postOrder) {
    if (angle.has(id)) {
      continue;
    }
    const children = childrenOf.get(id) ?? [];
    const sum = children.reduce(
      (acc, child) => acc + (angle.get(child) ?? 0),
      0,
    );

    angle.set(id, children.length ? sum / children.length : angleStart);
  }
}

function positionsFromAngles(
  depth: Map<string, number>,
  angle: Map<string, number>,
  angleStart: number,
  layout: { center: Point; ringGap: number },
): Map<string, Point> {
  const positions = new Map<string, Point>();

  for (const [id, d] of depth) {
    const a = angle.get(id) ?? angleStart;
    const r = d * layout.ringGap;

    positions.set(id, {
      x: layout.center.x + r * Math.cos(a),
      y: layout.center.y + r * Math.sin(a),
    });
  }

  return positions;
}

/** Radial-tree seed positions; depth→radius, leaves spread evenly. */
export function radialTree(
  root: string,
  childrenOf: Map<string, string[]>,
  opts: RadialTreeOptions,
): Map<string, Point> {
  const { center, ringGap } = opts;
  const { angleStart, angleEnd } = resolveAngleRange(opts);

  const depth = new Map<string, number>();
  const postOrder: string[] = [];
  const leaves: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string, d: number) => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    depth.set(id, d);
    const children = (childrenOf.get(id) ?? []).filter(
      (child) => !visited.has(child),
    );

    if (children.length === 0) {
      leaves.push(id);
    }

    for (const child of children) {
      visit(child, d + 1);
    }
    postOrder.push(id);
  };

  visit(root, 0);

  const span = angleEnd - angleStart;
  const leafCount = Math.max(leaves.length, 1);
  const angle = new Map<string, number>();

  leaves.forEach((id, i) =>
    angle.set(id, angleStart + (span * (i + 0.5)) / leafCount),
  );

  fillParentAngles(postOrder, childrenOf, angle, angleStart);

  return positionsFromAngles(depth, angle, angleStart, { center, ringGap });
}
