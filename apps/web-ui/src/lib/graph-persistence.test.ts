import { describe, it, expect } from "vitest";
import {
  applyGraphState,
  captureGraphState,
  parseGraphState,
  serializeGraphState,
} from "./graph-persistence";

describe("captureGraphState", () => {
  it("returns version 1 with empty positions and expanded for empty inputs", () => {
    expect(captureGraphState([], [])).toEqual({
      version: 1,
      positions: {},
      expanded: [],
    });
  });

  it("records an unpinned position keyed by id for a node without fixed coords", () => {
    expect(captureGraphState([{ id: "a", x: 10, y: 20 }], [])).toEqual({
      version: 1,
      positions: { a: { x: 10, y: 20, pinned: false } },
      expanded: [],
    });
  });

  it("records the fixed coords (not drifting x/y) and pinned true for a pinned node", () => {
    expect(
      captureGraphState([{ id: "a", x: 1, y: 2, fx: 10, fy: 20 }], []),
    ).toEqual({
      version: 1,
      positions: { a: { x: 10, y: 20, pinned: true } },
      expanded: [],
    });
  });
});

describe("applyGraphState", () => {
  it("mutates the matching node x/y to the saved 10,20 position", () => {
    const nodes = [{ id: "a", x: 0, y: 0 }];

    applyGraphState(
      {
        version: 1,
        positions: { a: { x: 10, y: 20, pinned: false } },
        expanded: [],
      },
      nodes,
    );
    expect(nodes[0]).toMatchObject({ id: "a", x: 10, y: 20 });
  });

  it("restores fx/fy to the saved 10,20 position when the saved position is pinned", () => {
    const nodes = [{ id: "a", x: 0, y: 0 }];

    applyGraphState(
      {
        version: 1,
        positions: { a: { x: 10, y: 20, pinned: true } },
        expanded: [],
      },
      nodes,
    );
    expect(nodes[0]).toMatchObject({ id: "a", x: 10, y: 20, fx: 10, fy: 20 });
  });
});

describe("serializeGraphState + parseGraphState", () => {
  it("round-trips a state with one unpinned position and one expanded spec", () => {
    const state = {
      version: 1,
      positions: { a: { x: 1, y: 2, pinned: false } },
      expanded: ["s1"],
    };

    expect(parseGraphState(serializeGraphState(state))).toEqual(state);
  });

  it("returns null for a corrupt non-JSON string", () => {
    expect(parseGraphState("not json{")).toBeNull();
  });

  it("returns null for a valid blob whose version 999 mismatches STATE_VERSION", () => {
    const staleBlob = JSON.stringify({
      version: 999,
      positions: { a: { x: 1, y: 2, pinned: false } },
      expanded: [],
    });

    expect(parseGraphState(staleBlob)).toBeNull();
  });
});
