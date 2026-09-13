import { describe, it, expect, afterEach } from "vitest";
import { DELIVERING_PROMPT_REFS } from "./delivering-recipes.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTaskTypesFile,
  warnOnDrift,
  TaskTypeConfigSchema,
} from "./task-types-config.js";

const COMMITTED = readFileSync(
  resolve(import.meta.dirname, "../../../../..", "scripts/task-types.yaml"),
  "utf8",
);

describe("parseTaskTypesFile", () => {
  it("accepts the committed scripts/task-types.yaml with no drift", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    expect(parsed.drift).toEqual([]);
    expect(Object.keys(parsed.taskTypes)).toHaveLength(21);
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
      "task_types.broken: prompt_template — Invalid input: expected string, received undefined",
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
      "task_types.general: <entry> — Invalid input: expected object, received null",
      "task_types.broken: <entry> — Invalid input: expected object, received string",
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
  it("tells every implementing recipe to commit and push, because the next node is another pod (18/18 implementation-loop branches shipped 0 commits, 2026-08-30)", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = parsed.taskTypes[name]?.prompt_template ?? "";

      expect(prompt, name).toContain("git push origin HEAD");
      expect(prompt, name).toContain("dies with it");
      expect(prompt, name).not.toContain("Do not commit or push");
    }
  });

  it("tells every delivering recipe to format the files it changed and never to run the linter", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = (parsed.taskTypes[name]?.prompt_template ?? "").replace(
        /\s+/g,
        " ",
      );

      expect(prompt, name).toContain(
        "run the repository's FORMATTER over the files you changed",
      );
      expect(prompt, name).toContain("Do NOT run the linter in this pod");
      expect(prompt, name).not.toContain("npx eslint");
    }
  });

  it("tells the loop's own recipes that CI judges the branch, so none re-runs the suite in a pod", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of ["acceptance-dod", "tdd-round", "fix-ci", "pr-ready"]) {
      const prompt = parsed.taskTypes[name]?.prompt_template ?? "";

      expect(prompt, name).toContain("CI is the judge of this branch");
    }
  });

  it("tells fix-ci to run only the checks the CI report named", () => {
    expect(
      parseTaskTypesFile(COMMITTED).taskTypes["fix-ci"]?.prompt_template,
    ).toContain("run ONLY that");
  });

  it("tells every delivering recipe not to typecheck or build in the pod: CI's build step proves compilation, tests read source, and tsc on libs/shared peaks near 950 MB against 1Gi", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = (parsed.taskTypes[name]?.prompt_template ?? "").replace(
        /\s+/g,
        " ",
      );

      expect(prompt, name).toContain("Do NOT typecheck here either");
      expect(prompt, name).toContain("NEVER run a workspace build in this pod");
      expect(prompt, name).not.toContain("npx tsc --noEmit");
    }
  });

  it("tells every delivering recipe to bring its branch up to date with the base before it stops", () => {
    const parsed = parseTaskTypesFile(COMMITTED);

    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = parsed.taskTypes[name]?.prompt_template ?? "";

      expect(prompt, name).toContain(
        "bring the branch up to date with its base",
      );
      expect(prompt, name).toContain("NO CI AT ALL");
    }
  });

  it("tells every implementing recipe but tdd-round and fix-ci to report failure when it delivered nothing", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const oneShot = DELIVERING_PROMPT_REFS.filter(
      (n) => n !== "tdd-round" && n !== "fix-ci",
    );

    for (const name of oneShot) {
      const prompt = parsed.taskTypes[name]?.prompt_template ?? "";

      expect(prompt, name).toContain('LORE_NODE_RESULT: {"outcome":"failed"}');
    }
  });

  it("lets a round that found the work already done report success, since failure would strand the branch", () => {
    const round = parseTaskTypesFile(COMMITTED).taskTypes["tdd-round"];

    expect(round?.prompt_template).toContain(
      'LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Tdd-Next":"acceptance green"}}',
    );
    expect(round?.prompt_template).toContain(
      "Report failure when you are STUCK, never when you are FINISHED",
    );
  });

  it("holds the DoD to the ticket's own claim — scope fidelity, not reinterpretation (bowman-ui #11, #1745)", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const dod = parsed.taskTypes["acceptance-dod"]?.prompt_template ?? "";

    expect(dod).toContain("SCOPE FIDELITY");
    expect(dod).toContain("central claim");
    expect(dod).toContain("fail BECAUSE of that claim");
    expect(dod).toContain("redefined the ticket");
  });

  it("bans acceptance tests whose subject is the repository's own source text (bowman-ui #8/#9/#10, #1743)", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const dod = parsed.taskTypes["acceptance-dod"]?.prompt_template ?? "";
    const round = parsed.taskTypes["tdd-round"]?.prompt_template ?? "";

    expect(dod).toContain("real entry point");
    expect(dod).toContain("own source text");
    expect(dod).toContain("compute the value");
    expect(round).toContain("own source text");
  });

  it("asks the definition of done to open with the ticket claim as a blockquote", () => {
    expect(
      parseTaskTypesFile(COMMITTED).taskTypes["acceptance-dod"]
        ?.prompt_template,
    ).toContain("> <the ticket's central claim, quoted verbatim>");
  });

  it("tells the definition-of-done step its verdict is posted on the issue", () => {
    expect(
      parseTaskTypesFile(COMMITTED).taskTypes["acceptance-dod"]
        ?.prompt_template,
    ).toContain("posted verbatim on the issue");
  });

  it("asks the definition of done for task-list checkboxes, so a round's progress renders", () => {
    const dod =
      parseTaskTypesFile(COMMITTED).taskTypes["acceptance-dod"]
        ?.prompt_template ?? "";

    expect(dod).toContain("## Done when these pass");
    expect(dod).toContain("- [ ] **<test name>**");
  });

  it("tells a round to tick the facet it closed rather than append to a log", () => {
    expect(
      parseTaskTypesFile(COMMITTED).taskTypes["tdd-round"]?.prompt_template,
    ).toContain("`- [ ]` becomes `- [x]`");
  });

  it("offers a mechanical strategy so a trivial ticket owes no new permanent test (#1744)", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const dod = parsed.taskTypes["acceptance-dod"]?.prompt_template ?? "";
    const round = parsed.taskTypes["tdd-round"]?.prompt_template ?? "";

    expect(dod).toContain("`mechanical`");
    expect(dod).toContain("EXISTING tests");
    expect(round).toContain("`mechanical`");
  });

  it("has pr-ready report issue coverage, and leaves the footer to the Floor", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const ready = parsed.taskTypes["pr-ready"]?.prompt_template ?? "";

    expect(ready).toContain('"Lore-Issue-Coverage"');
    expect(ready).toContain("Refs");
    expect(ready).not.toContain("Closes #");
  });

  it("keeps .lore/pr-body.md out of the commit — Lore reads it from the workspace", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const ready = parsed.taskTypes["pr-ready"]?.prompt_template ?? "";

    expect(ready).toContain("do NOT commit `.lore/pr-body.md`");
    expect(ready).toContain("from your workspace");
    expect(ready).not.toContain("and all of it is pushed");
  });

  it("has pr-ready rewrite stale spec prose and point anchors at assertions", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const ready = parsed.taskTypes["pr-ready"]?.prompt_template ?? "";

    expect(ready).toContain("rewrite the sentence");
    expect(ready).toContain("never a comment or blank line");
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

  it("has tdd-round ask which tests already cover a symbol before editing it", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const round = parsed.taskTypes["tdd-round"]?.prompt_template ?? "";

    expect(round).toContain("tests_covering");
    expect(round).toContain("REGRESSION");
  });

  it("has fix-ci ask what failed on a path before it reads any file", () => {
    const parsed = parseTaskTypesFile(COMMITTED);
    const fix = parsed.taskTypes["fix-ci"]?.prompt_template ?? "";

    expect(fix).toContain("failures_touching");
    expect(fix).toContain("still open");
  });
});

describe("the fix-ci recipe and a named failed step", () => {
  it("tells fix-ci to run only the failed step's command when the CI report names one", () => {
    expect(
      parseTaskTypesFile(COMMITTED).taskTypes["fix-ci"]?.prompt_template,
    ).toContain("run only that step's command");
  });
});

describe("the fix-ci recipe when the branch moved", () => {
  it("tells fix-ci to change nothing and report success when commits CI has not judged sit on top of the reported sha", () => {
    const fix =
      parseTaskTypesFile(COMMITTED).taskTypes["fix-ci"]?.prompt_template ?? "";

    expect(fix).toContain("..HEAD");
    expect(fix).toContain("the branch moved after CI judged it");
  });
});
