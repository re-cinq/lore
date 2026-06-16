import { describe, it, expect } from 'vitest';
import { invertPoint, applyPoint, findNodeAtPoint } from './graph-viewport';

describe('invertPoint', () => {
  it('inverts a translated and scaled screen point to world coordinates', () => {
    expect(invertPoint({ x: 100, y: 50, k: 2 }, { x: 140, y: 90 })).toEqual({ x: 20, y: 20 });
  });

  it('round-trips with applyPoint', () => {
    const transform = { x: 30, y: -12, k: 1.5 };
    const world = { x: 17, y: 42 };

    const back = invertPoint(transform, applyPoint(transform, world));

    expect(back.x).toBeCloseTo(17);
    expect(back.y).toBeCloseTo(42);
  });
});

describe('applyPoint', () => {
  it('maps a world point through the zoom transform to screen coordinates', () => {
    expect(applyPoint({ x: 100, y: 50, k: 2 }, { x: 20, y: 20 })).toEqual({ x: 140, y: 90 });
  });
});

describe('findNodeAtPoint', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, r: 10 },
    { id: 'b', x: 100, y: 0, r: 10 },
  ];

  it('returns the node whose disc contains the point', () => {
    expect(findNodeAtPoint({ x: 4, y: 3 }, nodes)).toBe('a');
  });

  it('returns the nearest node when discs overlap', () => {
    const overlapping = [
      { id: 'far', x: 0, y: 0, r: 30 },
      { id: 'near', x: 20, y: 0, r: 30 },
    ];

    expect(findNodeAtPoint({ x: 18, y: 0 }, overlapping)).toBe('near');
  });

  it('returns null when the point is outside every node radius', () => {
    expect(findNodeAtPoint({ x: 50, y: 50 }, nodes)).toBeNull();
  });

  it('counts a slop margin around each node radius', () => {
    expect(findNodeAtPoint({ x: 14, y: 0 }, nodes, 5)).toBe('a');
  });
});
