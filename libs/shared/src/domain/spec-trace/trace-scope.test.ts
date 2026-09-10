import { describe, it, expect } from "vitest";
import {
  mainScope,
  overlayScope,
  isOverlay,
  scopedXid,
  overlayKeyPrefix,
  rootEdge,
  parseOverlayKey,
} from "./trace-scope.js";

describe("mainScope", () => {
  it("keys on the bare repo and roots at Repo", () => {
    expect(mainScope("re-cinq/lore")).toEqual({
      repo: "re-cinq/lore",
      key: "re-cinq/lore",
      rootType: "Repo",
    });
  });

  it("returns false from isOverlay", () => {
    expect(isOverlay(mainScope("re-cinq/lore"))).toBe(false);
  });
});

describe("overlayScope", () => {
  it("inserts a run segment between the repo and the path and roots at Overlay", () => {
    expect(overlayScope("re-cinq/lore", "run-42")).toEqual({
      repo: "re-cinq/lore",
      key: "re-cinq/lore|run:run-42",
      rootType: "Overlay",
      assemblyRunId: "run-42",
    });
  });

  it("returns true from isOverlay", () => {
    expect(isOverlay(overlayScope("re-cinq/lore", "run-42"))).toBe(true);
  });
});

describe("scopedXid", () => {
  it("joins parts onto the main key with a pipe", () => {
    expect(scopedXid(mainScope("re-cinq/lore"), "src/a.ts")).toBe(
      "re-cinq/lore|src/a.ts",
    );
  });

  it("joins parts onto the overlay key so main and overlay never collide", () => {
    expect(scopedXid(overlayScope("re-cinq/lore", "run-42"), "src/a.ts")).toBe(
      "re-cinq/lore|run:run-42|src/a.ts",
    );
  });

  it("joins several parts in order", () => {
    expect(scopedXid(mainScope("re-cinq/lore"), "a.test.ts", "renders")).toBe(
      "re-cinq/lore|a.test.ts|renders",
    );
  });
});

describe("overlayKeyPrefix", () => {
  it("is the prefix every one of a run's xids starts with", () => {
    const prefix = overlayKeyPrefix("re-cinq/lore", "run-42");

    expect(scopedXid(overlayScope("re-cinq/lore", "run-42"), "x")).toContain(
      prefix,
    );
  });

  it("ends with the pipe that closes the run segment so run-4 cannot prefix-match run-42", () => {
    expect(overlayKeyPrefix("re-cinq/lore", "run-4")).toBe(
      "re-cinq/lore|run:run-4|",
    );
  });
});

describe("rootEdge", () => {
  it("names the Repo predicate for a main scope", () => {
    expect(rootEdge(mainScope("re-cinq/lore"), "test_chunks")).toBe(
      "Repo.test_chunks",
    );
  });

  it("names the Overlay predicate for an overlay scope", () => {
    expect(
      rootEdge(overlayScope("re-cinq/lore", "run-42"), "test_chunks"),
    ).toBe("Overlay.test_chunks");
  });
});

describe("parseOverlayKey", () => {
  it("recovers the repo and run id from an overlay key", () => {
    expect(parseOverlayKey("re-cinq/lore|run:run-42")).toEqual({
      repo: "re-cinq/lore",
      assemblyRunId: "run-42",
    });
  });

  it("returns null for a bare repo key", () => {
    expect(parseOverlayKey("re-cinq/lore")).toBeNull();
  });
});
