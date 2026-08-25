import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The guard a database trigger would not have needed.
 *
 * Fan-out is composed by each event-insert site rather than enforced by the
 * table, so a new writer CAN forget it — and a forgotten one produces events
 * with no deliveries, which nothing handles and nothing logs. That failure is
 * silent in production, so it is made loud in CI: every site that inserts an
 * event either IS the shared writer or composes the shared clause.
 */

const REPO_ROOT = join(import.meta.dirname, "../../../../..");

/** The one module allowed to write the bare INSERT: it composes the clause itself. */
const SHARED_WRITER = "libs/shared/src/events.ts";

/** A commented-out INSERT is documentation, not a writer — `detect/fan-out.ts`
 *  documents the manual operator trigger. Matching those would make the guard
 *  cry wolf, and an allowlist to silence it would go stale exactly the way this
 *  test exists to prevent. */
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
