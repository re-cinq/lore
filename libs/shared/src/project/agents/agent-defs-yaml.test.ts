import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentDefsYaml } from "./agent-defs-yaml.js";

/**
 * AgentDefsYaml maps task-types.yaml into org-level definitions and refuses
 * writes. Driven against a REAL yaml file written to a temp dir — no doubles.
 */

let dir: string;
let path: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-defs-yaml-"));
  path = join(dir, "task-types.yaml");
  writeFileSync(
    path,
    [
      "task_types:",
      "  general:",
      "    prompt_template: |",
      "      Task: {description}",
      "    timeout_minutes: 30",
      "    review_required: true",
      "    model: claude-sonnet-4-6",
      "  ingest-specs:",
      '    prompt_template: ""',
      "    timeout_minutes: 10",
      "    review_required: false",
      "    execution_mode: graph-ingest",
      "",
    ].join("\n"),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("AgentDefsYaml", () => {
  it("resolves a task type into an org-level definition", async () => {
    const store = new AgentDefsYaml(path);

    expect(await store.resolve("re-cinq/lore", "general")).toEqual({
      name: "general",
      model: "claude-sonnet-4-6",
      timeout_minutes: 30,
      prompt: "Task: {description}\n",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      project_id: null,
    });
  });

  it("maps a zero-LLM ingest type with no model and graph-ingest mode", async () => {
    const store = new AgentDefsYaml(path);

    expect(await store.resolve("re-cinq/lore", "ingest-specs")).toMatchObject({
      model: null,
      prompt: null,
      execution_mode: "graph-ingest",
    });
  });

  it("lists every defined agent sorted by name", async () => {
    const store = new AgentDefsYaml(path);

    expect((await store.list("re-cinq/lore")).map((a) => a.name)).toEqual([
      "general",
      "ingest-specs",
    ]);
  });

  it("returns null for an unknown agent name", async () => {
    expect(await new AgentDefsYaml(path).resolve("re-cinq/lore", "nope")).toBeNull();
  });

  it("refuses writes without a database", async () => {
    const store = new AgentDefsYaml(path);

    await expect(
      store.create("re-cinq/lore", {
        name: "x",
        model: null,
        timeout_minutes: null,
        prompt: null,
        image: null,
        execution_mode: "claude-code",
        review_required: false,
      }),
    ).rejects.toThrow(new Error("agent definitions are read-only without a database"));
  });
});
