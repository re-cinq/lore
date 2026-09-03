import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");

const SHARED_WRITER = "libs/shared/src/events.ts";

const isCode = (line: string): boolean => {
  const trimmed = line.trimStart();

  return !trimmed.startsWith("//") && !trimmed.startsWith("*");
};

const eventInsertSites = (): string[] =>
  execFileSync(
    "git",
    ["grep", "-l", "INSERT INTO pipeline.events", "--", "*.ts"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((path) => path.length > 0 && !path.endsWith(".test.ts"))
    .filter((path) =>
      readFileSync(join(REPO_ROOT, path), "utf8")
        .split("\n")
        .some(
          (line) =>
            isCode(line) && line.includes("INSERT INTO pipeline.events"),
        ),
    );

describe("every event-insert site fans out", () => {
  it("finds the writers by scanning rather than by a list that can go stale", () => {
    expect(eventInsertSites()).toContain(SHARED_WRITER);
  });

  it("has no writer that inserts an event without composing the fan-out clause", () => {
    const offenders = eventInsertSites()
      .filter((path) => path !== SHARED_WRITER)
      .filter(
        (path) =>
          !readFileSync(join(REPO_ROOT, path), "utf8").includes("fanOutClause"),
      );

    expect(offenders).toEqual([]);
  });
});
