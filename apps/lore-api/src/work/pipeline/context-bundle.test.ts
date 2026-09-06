import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildContextBundle } from "./context-bundle.js";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("buildContextBundle", () => {
  it("returns an empty string for no context", async () => {
    expect(await buildContextBundle(undefined)).toBe("");
  });

  it("returns an empty string for an empty context object", async () => {
    expect(await buildContextBundle({})).toBe("");
  });

  it("renders only the pipeline task section when only pipeline_task_id is set", async () => {
    const result = await buildContextBundle({ pipeline_task_id: "task-1" });

    expect(result).toBe("## Pipeline task\nTask ID: task-1");
  });

  it("renders only the seed query section when only seed_query is set", async () => {
    const result = await buildContextBundle({ seed_query: "find the bug" });

    expect(result).toBe("## Seed query\nfind the bug");
  });

  it("renders only the branch section when only branch is set", async () => {
    const result = await buildContextBundle({ branch: "feature/x" });

    expect(result).toBe("## Branch\nfeature/x");
  });

  it("joins multiple sections with the triple-dash separator in field order", async () => {
    const result = await buildContextBundle({
      pipeline_task_id: "task-1",
      seed_query: "find the bug",
      branch: "feature/x",
    });

    expect(result).toBe(
      "## Pipeline task\nTask ID: task-1\n\n---\n\n## Seed query\nfind the bug\n\n---\n\n## Branch\nfeature/x",
    );
  });

  it("adds no spec section when spec_file is true but no .specify files exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "context-bundle-empty-"));

    process.chdir(emptyDir);

    const result = await buildContextBundle({ spec_file: true });

    expect(result).toBe("");
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("labels both files Spec because the .specify directory name itself contains 'spec'", async () => {
    const dir = mkdtempSync(join(tmpdir(), "context-bundle-files-"));

    mkdirSync(join(dir, ".specify"));
    writeFileSync(join(dir, ".specify", "spec.md"), "spec body");
    writeFileSync(
      join(dir, ".specify", "constitution.md"),
      "constitution body",
    );
    process.chdir(dir);

    const result = await buildContextBundle({ spec_file: true });

    expect(result).toBe(
      "## Spec\nspec body\n\n---\n\n## Spec\nconstitution body",
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
