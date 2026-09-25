import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";
import { resolveNodeStation } from "./node-station.js";

const digest = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/daily-digest.yaml"),
    "utf8",
  ),
);

const successorsOf = (nodeId: string, on: string) =>
  digest.edges.filter((e) => e.from === nodeId && e.on === on).map((e) => e.to);

describe("the daily-digest line", () => {
  it("refines then finishes", () => {
    expect({ entry: digest.entry, exit: digest.exit, next: successorsOf("refine", "success") }).toEqual({
      entry: "refine",
      exit: "done",
      next: ["done"],
    });
  });

  it("reaches the exit when refine failed, so the draft can still be posted", () => {
    expect(successorsOf("refine", "failed")).toEqual(["done"]);
  });

  it("names the digest-refine station for the refine node, not the line's task type", () => {
    const refine = digest.nodes.find((n) => n.id === "refine");

    expect(resolveNodeStation(refine!, "daily-digest")).toEqual({
      station: "digest-refine",
      inherited: false,
    });
  });
});
