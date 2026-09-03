import { describe, it, expect, afterEach } from "vitest";
import { DELIVERING_PROMPT_REFS } from "./delivering-recipes.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTaskTypesFile,
  warnOnDrift,
  TaskTypeConfigSchema,
} from "./task-types-config.js";

/** The committed file the four readers all parse. Resolved from this module so the
 *  dist/ glob run (libs/shared/dist/task-types) lands on the same four-up root. */
const COMMITTED = readFileSync(
  resolve(import.meta.dirname, "../../../..", "scripts/task-types.yaml"),
  "utf8",
);

describe("parseTaskTypesFile", () => {
  it("accepts the committed scripts/task-types.yaml with no drift", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    expect(parsed.drift).toEqual([]);
    expect(Object.keys(parsed.taskTypes)).toHaveLength(21);
    // The NAMES, not a count: a bare number says a station went and not which,
    // and the recipes here have to stay in step with the station registry —
    // pod-runtime stations only; comment-triage left when it pooled (its
    // manifest says runtime "service", so no pod recipe exists for it).
    expect(Object.keys(parsed.stations).sort()).toEqual([
      "detect",
      "ingest",
      "issues",
      "retrospective",
      "validate",
    ]);
  });

  it("reads an explicit target_repo: null as null, not as an absent field", () => {
    const parsed = parseTaskTypesFile(
      "task_types:\n  onboard:\n    prompt_template: p\n    timeout_minutes: 5\n    review_required: false\n    model: claude-sonnet-5\n    target_repo: null\n",
    );

    expect(parsed.taskTypes.onboard).toMatchObject({ target_repo: null });
  });

  it("reports drift instead of throwing when a task type omits prompt_template", () => {
    const parsed = parseTaskTypesFile(
      "task_types:\n  broken:\n    timeout_minutes: 5\n    review_required: false\n    model: claude-sonnet-5\n",
    );

    expect(parsed.drift).toEqual([
      "task_types.broken: prompt_template — Required",
    ]);
    expect(parsed.taskTypes.broken).toMatchObject({ timeout_minutes: 5 });
  });

  it("keeps the station fields the agent catalog reads: command, env and pod_labels", () => {
    const { stations } = parseTaskTypesFile(COMMITTED);

    expect(stations.ingest).toMatchObject({
      command: expect.arrayContaining(["lore-station"]),
      env: expect.any(Object),
    });
  });
});

describe("TaskTypeConfigSchema", () => {
  it("declares prompt_template, timeout_minutes, review_required and model required", () => {
    const missing = TaskTypeConfigSchema.safeParse({});

    expect(
      missing.success
        ? []
        : missing.error.issues.map((i) => i.path.join(".")).sort(),
    ).toEqual([
      "model",
      "prompt_template",
      "review_required",
      "timeout_minutes",
    ]);
  });
});

describe("an entry a reader cannot read at all", () => {
  const BODYLESS = "task_types:\n  general:\n  broken: hello\n";

  it("names the entry, not an empty field, in the drift line", () => {
    const { drift } = parseTaskTypesFile(BODYLESS);

    expect(drift).toEqual([
      "task_types.general: <entry> — Expected object, received null",
      "task_types.broken: <entry> — Expected object, received string",
    ]);
  });

  it("keeps it as an empty recipe rather than as null", () => {
    const { taskTypes } = parseTaskTypesFile(BODYLESS);

    expect(taskTypes).toEqual({ general: {}, broken: {} });
  });

  it("keeps what it CAN read of an entry that is merely incomplete", () => {
    const { taskTypes } = parseTaskTypesFile(
      "task_types:\n  general:\n    prompt_template: Do {description}\n",
    );

    expect(taskTypes.general).toEqual({
      prompt_template: "Do {description}",
    });
  });
});

describe("warnOnDrift", () => {
  const realWarn = console.warn;

  afterEach(() => {
    console.warn = realWarn;
  });

  it("says nothing when the file matches the schema", () => {
    const said: string[] = [];

    console.warn = (message: string) => said.push(message);
    warnOnDrift("[floor]", "/config/task-types.yaml", []);

    expect(said).toEqual([]);
  });

  it("names the reader, the file and every mismatch", () => {
    const said: string[] = [];

    console.warn = (message: string) => said.push(message);
    warnOnDrift("[floor]", "/config/task-types.yaml", [
      "task_types.general: model — Required",
      "stations.ingest: command — Required",
    ]);

    expect(said).toEqual([
      "[floor] /config/task-types.yaml does not match the task-type schema: " +
        "task_types.general: model — Required; stations.ingest: command — Required",
    ]);
  });
});

describe("the implementation-tdd recipe", () => {
  it("tells every implementing recipe to commit and push, because the next node is another pod", () => {
    // 18 of 18 implementation-loop branches ever created carry 0 commits
    // (2026-08-30). The push recipe assumed it shared a worktree with implement;
    // since the per-node-pod cutover each node clones fresh, so the implement
    // pod's edits died with the pod, validate diffed an empty branch, and push
    // found "nothing to deliver". spec-write — the one recipe that ships — says
    // "commit it, and stop"; these never did.
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = parsed.taskTypes[name]?.prompt_template ?? "";

      expect(prompt, name).toContain("git push origin HEAD");
      expect(prompt, name).toContain("dies with it");
      expect(prompt, name).not.toContain("Do not commit or push");
    }
  });

  it("tells every implementing recipe to report failure when it delivered nothing", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = parsed.taskTypes[name]?.prompt_template ?? "";

      expect(prompt, name).toContain('LORE_NODE_RESULT: {"outcome":"failed"}');
    }
  });

  it("demands red before green, inline validated-by links, and the status flip, leaving implementation untouched", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const tdd = parsed.taskTypes["implementation-tdd"]?.prompt_template ?? "";

    expect(tdd).toContain("failing test");
    expect(tdd).toContain("Red first");
    expect(tdd).toContain("validated by");
    expect(tdd).toContain("| Status |");
    expect(parsed.taskTypes["implementation"]?.prompt_template).not.toContain(
      "Red first",
    );
  });
});

describe("the acceptance-dod recipe", () => {
  it("forbids self-referential source-reading meta-tests", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const dod = parsed.taskTypes["acceptance-dod"]?.prompt_template ?? "";

    // The recipe must name the failure mode it guards against. Calling it
    // "meta-test" is what stops the pod from producing one when the ticket
    // is about recipe behaviour rather than a runtime seam.
    expect(dod).toContain("meta-test");
  });
});
