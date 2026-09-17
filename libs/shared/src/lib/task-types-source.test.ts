import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTaskTypesSource } from "./task-types-source.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "task-types-source-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readTaskTypesSource", () => {
  it("returns task-types.yaml then task-types.implementation-loop.yaml as one stream, skipping unrelated.yaml", () => {
    writeFileSync(join(dir, "task-types.yaml"), "main\n");
    writeFileSync(join(dir, "task-types.implementation-loop.yaml"), "loop\n");
    writeFileSync(join(dir, "unrelated.yaml"), "ignored\n");

    expect(readTaskTypesSource(join(dir, "task-types.yaml"))).toBe(
      "main\n\n---\nloop\n",
    );
  });

  it("throws ENOENT when the main task-types.yaml is missing", () => {
    expect(() => readTaskTypesSource(join(dir, "task-types.yaml"))).toThrow(
      /ENOENT/,
    );
  });
});
