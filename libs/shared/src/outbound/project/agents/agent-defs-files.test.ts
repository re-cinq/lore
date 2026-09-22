import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentDefsFiles } from "./agent-defs-files.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-defs-files-"));
  writeFileSync(
    join(dir, "general.md"),
    "---\nmodel: claude-sonnet-4-6\ntimeout_minutes: 30\nreview_required: true\n---\nTask: {description}\n",
  );
  writeFileSync(
    join(dir, "review.md"),
    "---\nmodel: claude-haiku-4-5-20251001\ntest_policy: none\n---\nReview it.\n",
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("AgentDefsFiles", () => {
  it("resolves general.md into an org-level definition", async () => {
    expect(
      await new AgentDefsFiles(dir).resolve("re-cinq/lore", "general"),
    ).toEqual({
      name: "general",
      model: "claude-sonnet-4-6",
      timeout_minutes: 30,
      prompt: "Task: {description}\n",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      project_id: null,
      config: null,
    });
  });

  it("returns null for an agent with no file", async () => {
    expect(
      await new AgentDefsFiles(dir).resolve("re-cinq/lore", "nope"),
    ).toBeNull();
  });

  it("lists general and review sorted by name, review carrying test_policy none on config", async () => {
    const listed = await new AgentDefsFiles(dir).list("re-cinq/lore");

    expect(listed.map((d) => [d.name, d.config])).toEqual([
      ["general", null],
      ["review", { test_policy: "none" }],
    ]);
  });

  it("refuses writes without a database", async () => {
    const store = new AgentDefsFiles(dir);

    await expect(store.delete("re-cinq/lore", "general")).rejects.toThrow(
      new Error("agent definitions are read-only without a database"),
    );
  });
});
