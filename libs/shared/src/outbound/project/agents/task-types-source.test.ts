import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTaskTypesFile } from "../../../domain/task-types/task-types-config.js";
import { readTaskTypesSource } from "./task-types-source.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "task-types-source-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const entry = (name: string): string =>
  `task_types:\n  ${name}:\n    prompt_template: ${name}\n`;

describe("readTaskTypesSource", () => {
  it("returns general then tdd-round when task-types.implementation-loop.yaml sits beside task-types.yaml", () => {
    writeFileSync(join(dir, "task-types.yaml"), entry("general"));
    writeFileSync(
      join(dir, "task-types.implementation-loop.yaml"),
      entry("tdd-round"),
    );
    writeFileSync(join(dir, "unrelated.yaml"), entry("ignored"));

    const { taskTypes } = parseTaskTypesFile(
      readTaskTypesSource(join(dir, "task-types.yaml")),
    );

    expect(Object.keys(taskTypes)).toEqual(["general", "tdd-round"]);
  });

  it("throws when the main task-types.yaml is missing", () => {
    expect(() => readTaskTypesSource(join(dir, "task-types.yaml"))).toThrow(
      /ENOENT/,
    );
  });
});
