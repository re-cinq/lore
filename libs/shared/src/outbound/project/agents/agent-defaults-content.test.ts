import { describe, it, expect } from "vitest";
import { DELIVERING_PROMPT_REFS } from "../../../domain/task-types/delivering-recipes.js";
import { loadAgentDefaults } from "./agent-defaults-files.js";

const SHIPPED = new Map(loadAgentDefaults().map((def) => [def.name, def]));

function promptOf(name: string): string {
  return SHIPPED.get(name)?.prompt ?? "";
}

describe("the implementation-tdd recipe", () => {
  it("tells every implementing recipe to commit and push, because the next node is another pod (18/18 implementation-loop branches shipped 0 commits, 2026-08-30)", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain("git push origin HEAD");
      expect(prompt, name).toContain("dies with it");
      expect(prompt, name).not.toContain("Do not commit or push");
    }
  });

  it("tells every delivering recipe to format the files it changed and never to run the linter", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name).replace(/\s+/g, " ");

      expect(prompt, name).toContain(
        "run the repository's FORMATTER over the files you changed",
      );
      expect(prompt, name).toContain("Do NOT run the linter in this pod");
      expect(prompt, name).not.toContain("npx eslint");
    }
  });

  it("tells the loop's own recipes that CI judges the branch, so none re-runs the suite in a pod", () => {
    for (const name of ["acceptance-dod", "tdd-round", "fix-ci", "pr-ready"]) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain("CI is the judge of this branch");
    }
  });

  it("tells fix-ci to run only the checks the CI report named", () => {
    expect(promptOf("fix-ci")).toContain("run ONLY that");
  });

  it("tells every delivering recipe not to typecheck or build in the pod: CI's build step proves compilation, tests read source, and tsc on libs/shared peaks near 950 MB against 1Gi", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name).replace(/\s+/g, " ");

      expect(prompt, name).toContain("Do NOT typecheck here either");
      expect(prompt, name).toContain("NEVER run a workspace build in this pod");
      expect(prompt, name).not.toContain("npx tsc --noEmit");
    }
  });

  it("tells every recipe that writes tests to run the spec-link re-anchor script after the formatter, when the repository has one", () => {
    for (const name of [
      "implementation-tdd",
      "acceptance-dod",
      "tdd-round",
      "pr-ready",
    ]) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain("node scripts/spec-links/reanchor.mjs");
      expect(prompt, name).toMatch(
        /from the repository root\s+after\s+the formatter/,
      );
      expect(prompt, name).not.toMatch(
        /re-verify\s+every existing #Lnn link on the statements you touch,/,
      );
    }
  });

  it("tells every delivering recipe to bring its branch up to date with the base before it stops", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain(
        "bring the branch up to date with its base",
      );
      expect(prompt, name).toContain("NO CI AT ALL");
    }
  });

  it("tells every implementing recipe but tdd-round and fix-ci to report failure when it delivered nothing", () => {
    const oneShot = DELIVERING_PROMPT_REFS.filter(
      (n) => n !== "tdd-round" && n !== "fix-ci",
    );

    for (const name of oneShot) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain('LORE_NODE_RESULT: {"outcome":"failed"}');
    }
  });

  it("lets a round that found the work already done report success, since failure would strand the branch", () => {
    const round = SHIPPED.get("tdd-round");

    expect(round?.prompt).toContain(
      'LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Tdd-Next":"acceptance green"}}',
    );
    expect(round?.prompt).toContain(
      "Report failure when you are STUCK, never when you are FINISHED",
    );
  });

  it("holds the DoD to the ticket's own claim — scope fidelity, not reinterpretation (bowman-ui #11, #1745)", () => {
    const dod = promptOf("acceptance-dod");

    expect(dod).toContain("SCOPE FIDELITY");
    expect(dod).toContain("central claim");
    expect(dod).toContain("fail BECAUSE of that claim");
    expect(dod).toContain("redefined the ticket");
  });

  it("bans acceptance tests whose subject is the repository's own source text (bowman-ui #8/#9/#10, #1743)", () => {
    const dod = promptOf("acceptance-dod");
    const round = promptOf("tdd-round");

    expect(dod).toContain("real entry point");
    expect(dod).toContain("own source text");
    expect(dod).toContain("compute the value");
    expect(round).toContain("own source text");
  });

  it("asks the definition of done to open with the ticket claim as a blockquote", () => {
    expect(promptOf("acceptance-dod")).toContain(
      "> <the ticket's central claim, quoted verbatim>",
    );
  });

  it("tells the definition-of-done step its verdict is posted on the issue", () => {
    expect(promptOf("acceptance-dod")).toContain(
      "posted verbatim on the issue",
    );
  });

  it("asks the definition of done for task-list checkboxes, so a round's progress renders", () => {
    const dod = promptOf("acceptance-dod");

    expect(dod).toContain("## Done when these pass");
    expect(dod).toContain("- [ ] **<test name>**");
  });

  it("tells a round to tick the facet it closed rather than append to a log", () => {
    expect(promptOf("tdd-round")).toContain("`- [ ]` becomes `- [x]`");
  });

  it("offers a mechanical strategy so a trivial ticket owes no new permanent test (#1744)", () => {
    const dod = promptOf("acceptance-dod");
    const round = promptOf("tdd-round");

    expect(dod).toContain("`mechanical`");
    expect(dod).toContain("EXISTING tests");
    expect(round).toContain("`mechanical`");
  });

  it("has pr-ready report issue coverage, and leaves the footer to the Floor", () => {
    const ready = promptOf("pr-ready");

    expect(ready).toContain('"Lore-Issue-Coverage"');
    expect(ready).toContain("Refs");
    expect(ready).not.toContain("Closes #");
  });

  it("keeps .lore/pr-body.md out of the commit — Lore reads it from the workspace", () => {
    const ready = promptOf("pr-ready");

    expect(ready).toContain("do NOT commit `.lore/pr-body.md`");
    expect(ready).toContain("from your workspace");
    expect(ready).not.toContain("and all of it is pushed");
  });

  it("has pr-ready rewrite stale spec prose and point anchors at assertions", () => {
    const ready = promptOf("pr-ready");

    expect(ready).toContain("rewrite the sentence");
    expect(ready).toContain("never a comment or blank line");
  });

  it("demands red before green, inline validated-by links, and the status flip, leaving implementation untouched", () => {
    const tdd = promptOf("implementation-tdd");

    expect(tdd).toContain("failing test");
    expect(tdd).toContain("Red first");
    expect(tdd).toContain("validated by");
    expect(tdd).toContain("| Status |");
    expect(promptOf("implementation")).not.toContain("Red first");
  });

  it("has tdd-round ask which tests already cover a symbol before editing it", () => {
    const round = promptOf("tdd-round");

    expect(round).toContain("tests_covering");
    expect(round).toContain("REGRESSION");
  });

  it("has fix-ci ask what failed on a path before it reads any file", () => {
    const fix = promptOf("fix-ci");

    expect(fix).toContain("failures_touching");
    expect(fix).toContain("still open");
  });
});

describe("the fix-ci recipe and a named failed step", () => {
  it("tells fix-ci to run only the failed step's command when the CI report names one", () => {
    expect(promptOf("fix-ci")).toContain("run only that step's command");
  });
});

describe("the fix-ci recipe when the branch moved", () => {
  it("tells fix-ci to change nothing and report success when commits CI has not judged sit on top of the reported sha", () => {
    const fix = promptOf("fix-ci");

    expect(fix).toContain("..HEAD");
    expect(fix).toContain("the branch moved after CI judged it");
  });
});

describe("test_policy", () => {
  it("declares none on every read-only review recipe, so a review pod cannot run tests, installs or builds at all", () => {
    const readOnly = [
      "review",
      "code-review",
      "code-review-recheck",
      "code-review-refine",
      "pr-ready",
    ];

    expect(
      readOnly.map((name) => SHIPPED.get(name)?.config?.test_policy),
    ).toEqual(readOnly.map(() => "none"));
  });
});

describe("the feature-planning recipe", () => {
  it("tells the planning agent to gather from lore_assemble_context and the lore_query_graph knowledge graph before it writes", () => {
    const prompt = promptOf("feature-planning");
    const gather = prompt.indexOf("## Gather before you write");

    expect({
      gatherFirst:
        gather >= 0 && gather < prompt.indexOf("## Your deliverable"),
      context: prompt.includes("`lore_assemble_context`"),
      graph: prompt.includes("`lore_query_graph`"),
      trace: prompt.includes("`query_trace`"),
    }).toEqual({ gatherFirst: true, context: true, graph: true, trace: true });
  });

  it("tells the planning agent that Open questions holds only question fences, so it never restates its questions there as a list", () => {
    const prompt = promptOf("feature-planning");

    expect({
      onlyFences: prompt.includes(
        "only when it belongs to no other section. That section holds only",
      ),
      noRestating: prompt.includes("Never list or restate questions"),
    }).toEqual({ onlyFences: true, noRestating: true });
  });

  it("gives the planning agent its plan as a downloaded plan.md and takes the edited file back by upload", () => {
    expect(SHIPPED.get("feature-planning")?.config).toMatchObject({
      inputs: [{ path: "plan.md", source: "plan" }],
      watch: { event: "planning.result", path: "plan.md", upload: true },
    });
  });

  it("gives the spec steps after approval the approved plan as plan.md rather than in their prompt", () => {
    expect(
      ["spec-analysis", "spec-write"].map(
        (name) => SHIPPED.get(name)?.config?.inputs,
      ),
    ).toEqual([
      [{ path: "plan.md", source: "plan" }],
      [{ path: "plan.md", source: "plan" }],
    ]);
  });
});
