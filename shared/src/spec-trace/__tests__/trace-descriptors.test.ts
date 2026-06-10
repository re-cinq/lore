import { describe, it, expect } from "vitest";
import { descriptorsFromVitestList, groupRunsByFile } from "../trace-descriptors.js";

describe("descriptorsFromVitestList", () => {
  it("turns one vitest entry into a per-it descriptor with id, name, file, and suite chain", () => {
    const out = descriptorsFromVitestList(
      [{ name: "Outer > Inner > does a thing", file: "/home/u/repo/shared/src/spec-trace/x.test.ts" }],
      { pkg: "shared" },
    );
    expect(out).toEqual([
      {
        id: "shared/src/spec-trace/x.test.ts::Outer > Inner > does a thing",
        name: "Outer > Inner > does a thing",
        file: "shared/src/spec-trace/x.test.ts",
        suite: ["Outer", "Inner"],
      },
    ]);
  });

  it("omits suite for a top-level it with no describe", () => {
    const [d] = descriptorsFromVitestList(
      [{ name: "bare test", file: "/r/shared/src/a.test.ts" }],
      { pkg: "shared" },
    );
    expect(d).toEqual({ id: "shared/src/a.test.ts::bare test", name: "bare test", file: "shared/src/a.test.ts" });
  });

  it("drops a stale dist/ path that is not under <pkg>/src/", () => {
    expect(
      descriptorsFromVitestList([{ name: "X > y", file: "/r/shared/dist/a.test.js" }], { pkg: "shared" }),
    ).toEqual([]);
  });

  it("keeps two its in the same file as two distinct descriptors", () => {
    const out = descriptorsFromVitestList(
      [
        { name: "Unit > a", file: "/r/shared/src/a.test.ts" },
        { name: "Unit > b", file: "/r/shared/src/a.test.ts" },
      ],
      { pkg: "shared" },
    );
    expect(out.map((d) => d.id)).toEqual([
      "shared/src/a.test.ts::Unit > a",
      "shared/src/a.test.ts::Unit > b",
    ]);
  });
});

describe("groupRunsByFile", () => {
  it("groups descriptor ids by file in first-appearance order", () => {
    const grouped = groupRunsByFile([
      { id: "a.test.ts::x", name: "x", file: "a.test.ts" },
      { id: "b.test.ts::y", name: "y", file: "b.test.ts" },
      { id: "a.test.ts::z", name: "z", file: "a.test.ts" },
    ]);
    expect([...grouped.entries()]).toEqual([
      ["a.test.ts", ["a.test.ts::x", "a.test.ts::z"]],
      ["b.test.ts", ["b.test.ts::y"]],
    ]);
  });
});
