import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

  it("writes the PR description beside the clone, where Lore reads it and git never sees it", () => {
    const ready = promptOnOneLine("pr-ready");

    expect({
      namesBodyBesideClone: ready.includes("`../pr-body.md`"),
      saysOutsideGit: ready.includes("beside the clone, outside git"),
      namesOldInCloneBody: ready.includes(".lore/pr-body.md"),
      pushesEverything: ready.includes("and all of it is pushed"),
    }).toEqual({
      namesBodyBesideClone: true,
      saysOutsideGit: true,
      namesOldInCloneBody: false,
      pushesEverything: false,
    });
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

describe("the review recipes' findings block", () => {
  it("shows a whole finding with path, line, label, decoration and subject in every recipe that asks for REVIEW_FINDINGS, so no model guesses the shape (#2143's recheck lost every finding)", () => {
    const shapes = ["code-review", "code-review-recheck"].map((name) => {
      const prompt = promptOf(name);

      return ['"path"', '"line"', '"label"', '"decoration"', '"subject"'].every(
        (field) => prompt.includes(field),
      );
    });

    expect(shapes).toEqual([true, true]);
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

  it("tells the planning agent that Open questions holds only questions, so it never restates its questions there as a list", () => {
    const prompt = promptOf("feature-planning");

    expect({
      onlyQuestions: prompt.includes(
        "only when it belongs to no other section. That section holds only",
      ),
      noRestating: prompt.includes("Never list or restate questions"),
    }).toEqual({ onlyQuestions: true, noRestating: true });
  });

  it("edits the live plan through lore_plan_read and lore_plan_edit instead of uploading a file", () => {
    const config = SHIPPED.get("feature-planning")?.config;
    const prompt = promptOnOneLine("feature-planning");

    expect(config).toMatchObject({
      inputs: [{ path: "plan.md", source: "plan" }],
    });
    expect(config?.watch).toBeUndefined();
    expect({
      read: prompt.includes("lore_plan_read"),
      edit: prompt.includes("lore_plan_edit"),
      onePerCall: prompt.includes("one op per call"),
      planIdSlot: prompt.includes("{plan_id}"),
      expectHash: prompt.includes("expect"),
      readAgain: prompt.includes("read the plan again"),
      neverConversation: prompt.includes("never touch the conversation"),
      briefSlot: prompt.includes("{description}"),
    }).toEqual({
      read: true,
      edit: true,
      onePerCall: true,
      planIdSlot: true,
      expectHash: true,
      readAgain: true,
      neverConversation: true,
      briefSlot: true,
    });
  });

  it("hands the spec-write recipe the analysis through a {spec_plan} slot and tells it to amend the statements named there rather than guess from plan.md (#2175)", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      slot: promptOf("spec-write").includes("{spec_plan}"),
      amendInPlace: prompt.includes(
        "amend that statement rather than adding a rival beside it",
      ),
      leftAlone: prompt.includes("left alone is out of bounds"),
      kpis: prompt.includes("never the plan's"),
      openQuestions: prompt.includes("Never answer it for the author"),
      overtaken: prompt.includes("amend or retire each one the plan overtakes"),
    }).toEqual({
      slot: true,
      amendInPlace: true,
      leftAlone: true,
      kpis: true,
      openQuestions: true,
      overtaken: true,
    });
  });

  it("has the spec-write recipe fill the spec-kit artifact set from the in-repo templates and convert every NEEDS CLARIFICATION marker to a plan question", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      specTemplate: prompt.includes(".specify/templates/spec-template.md"),
      planTemplate: prompt.includes(".specify/templates/plan-template.md"),
      tasksTemplate: prompt.includes(".specify/templates/tasks-template.md"),
      constitution: prompt.includes(".specify/memory/constitution.md"),
      artifactSet: prompt.includes("the full artifact set"),
      noCli: prompt.includes("there is no `specify` CLI to run in this pod"),
      markerConversion: prompt.includes(
        "A committed file contains ZERO `[NEEDS CLARIFICATION` strings",
      ),
      checklistZeroMarkers: prompt.includes(
        "zero `[NEEDS CLARIFICATION` strings remain in any committed file",
      ),
      planNamingSplit: prompt.includes(
        "TWO DIFFERENT FILES ARE CALLED plan.md",
      ),
    }).toEqual({
      specTemplate: true,
      planTemplate: true,
      tasksTemplate: true,
      constitution: true,
      artifactSet: true,
      noCli: true,
      markerConversion: true,
      checklistZeroMarkers: true,
      planNamingSplit: true,
    });
  });

  it("has the feature-decompose recipe transcribe a reviewed tasks.md instead of re-deriving a breakdown", () => {
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      primaryInput: prompt.includes("it is the PRIMARY input"),
      transcribe: prompt.includes(
        "transcribe the reviewed breakdown, do not re-derive one",
      ),
      fallback: prompt.includes("absent or silent"),
    }).toEqual({
      primaryInput: true,
      transcribe: true,
      fallback: true,
    });
  });

  it("tells the spec-write recipe to answer a spec review item by item — amend what the plan settled, send what contradicts it to the plan as a question — and to always write spec-review-result.json", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      watch: SHIPPED.get("spec-write")?.config?.watch,
      addressed: prompt.includes('"action": "addressed"'),
      toPlan: prompt.includes("change NOTHING for it"),
      neverAnswer: prompt.includes("Never answer for the plan's people"),
      always: prompt.includes("Always write `../spec-review-result.json`"),
      empty: prompt.includes('{"plan_questions": [], "replies": []}'),
      noChangeIsSuccess: prompt.includes(
        'the specs are right as they stand — `spec-review-result.json` is your delivery, so end with `LORE_NODE_RESULT: {"outcome":"success"}`',
      ),
    }).toEqual({
      watch: {
        event: "spec.review.result",
        path: "spec-review-result.json",
      },
      addressed: true,
      toPlan: true,
      neverAnswer: true,
      always: true,
      empty: true,
      noChangeIsSuccess: true,
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

  it("writes every watched artifact outside the clone, never under target/", () => {
    const watchedInsideClone = [...SHIPPED.entries()]
      .filter(([, def]) => def.config?.watch)
      .map(([name, def]) => [name, def.config?.watch?.path])
      .filter(([, path]) => path?.startsWith("target/"));

    expect(watchedInsideClone).toEqual([]);
  });
});

function promptOnOneLine(name: string): string {
  return promptOf(name).replace(/\s+/g, " ");
}

describe("the code-review recipe reads the change as its user first", () => {
  it("asks, for every spec statement the PR adds or changes, what a person using that surface sees differently, and files a mismatch as a question rather than silence", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      asUser: prompt.includes("what a person using that surface"),
      neighbours: prompt.includes("the statements beside it"),
      question: prompt.includes("label it `question`"),
    }).toEqual({ asUser: true, neighbours: true, question: true });
  });

  it("names lint, types, formatting and tests as CI's verdict, read through lore_get_ci_failures, so the review spends no commands reproducing them", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      ciJudges: prompt.includes("CI's verdict"),
      tool: prompt.includes("`lore_get_ci_failures`"),
      noEslint: prompt.includes("not eslint, tsc or a formatter"),
    }).toEqual({ ciJudges: true, tool: true, noEslint: true });
  });

  it("reads the diff once in place and never dumps it to a file to re-read", () => {
    expect(promptOnOneLine("code-review")).toContain(
      "Read the diff once, in place",
    );
  });

  it("queries context with the PR's subject, spec and surface, never with a description of reviewing", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      subject: prompt.includes("the PR title, the spec sections it touches"),
      reviewingQueryRuledOut: prompt.includes('not "PR review conventions"'),
    }).toEqual({ subject: true, reviewingQueryRuledOut: true });
  });

  it("reserves changes_requested for a defect in the changed code or a mismatch between the spec and what a person would expect, and says a question alone does not block", () => {
    const prompt = promptOnOneLine("code-review");

    expect({
      mismatch: prompt.includes(
        "a mismatch between what the spec says and what a person would expect",
      ),
      questionNoBlock: prompt.includes("A `question` alone never blocks"),
    }).toEqual({ mismatch: true, questionNoBlock: true });
  });
});

describe("the plan-validate recipe", () => {
  it("reads plan.md read-only and writes plan-validation.json, never editing the plan", () => {
    const prompt = promptOnOneLine("plan-validate");

    expect({
      config: SHIPPED.get("plan-validate")?.config,
      readsPlan: prompt.includes("../plan.md"),
      writesValidation: prompt.includes("../plan-validation.json"),
      neverEdits: prompt.includes("Never edit the plan"),
      standingFindingById: prompt.includes("by its id"),
      fixedTextNamesStrings: prompt.includes("names its strings"),
      newWireNamesFields: prompt.includes("names its fields"),
      newStoreRetention: prompt.includes("retention and erasure"),
      verifiedClaimNamesTarget: prompt.includes("verified against"),
      severity: prompt.includes("severity"),
      success: prompt.includes('LORE_NODE_RESULT: {"outcome":"success"}'),
    }).toEqual({
      config: {
        inputs: [{ path: "plan.md", source: "plan" }],
        watch: {
          event: "plan.validation.result",
          path: "plan-validation.json",
        },
      },
      readsPlan: true,
      writesValidation: true,
      neverEdits: true,
      standingFindingById: true,
      fixedTextNamesStrings: true,
      newWireNamesFields: true,
      newStoreRetention: true,
      verifiedClaimNamesTarget: true,
      severity: true,
      success: true,
    });
  });
});

describe("the code-review-recheck recipe judges the push, not the pull request", () => {
  it("reads the range since the sha the last verdict judged, rather than the whole PR again", () => {
    const prompt = promptOnOneLine("code-review-recheck");

    expect({
      named: prompt.includes("names the sha the last verdict judged"),
      range: prompt.includes("..HEAD` and judge that range"),
      whole: prompt.includes("When no sha is named, read `main...HEAD`"),
    }).toEqual({ named: true, range: true, whole: true });
  });

  it("carries the same CI-verdict and read-once rules as the deep review, so a re-check runs no linter either", () => {
    const prompt = promptOnOneLine("code-review-recheck");

    expect({
      ci: prompt.includes("CI's verdict"),
      tool: prompt.includes("`lore_get_ci_failures`"),
      noEslint: prompt.includes("not eslint, tsc or a formatter"),
      once: prompt.includes("Read each diff once, in place"),
    }).toEqual({ ci: true, tool: true, noEslint: true, once: true });
  });

  it("queries context with the PR title and the surface the new commits change", () => {
    expect(promptOnOneLine("code-review-recheck")).toContain(
      "the PR title and the surface these commits change",
    );
  });
});

describe("the gap-fill and general recipes", () => {
  it("let a draft that finds the context already current report changes_requested, so a true no-op ends the run without a PR instead of failing an empty branch", () => {
    for (const name of ["gap-fill", "general"]) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain(
        'LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"Lore-Already-Current":',
      );
      expect(prompt, name).toContain("Report failure when you are STUCK");
    }
  });
});

describe("the planning recipes check a plan against what the platform has (issue-triage plan #2257, 2026-09-29)", () => {
  it("has plan-validate report a mechanism the repository lacks as a blocking INFEASIBILITY, walking the assembly-line guide", () => {
    const prompt = promptOnOneLine("plan-validate");

    expect({
      category: prompt.includes("**INFEASIBILITY**"),
      searched: prompt.includes("Check each one in the code, not by its name"),
      guide: prompt.includes(".lore/assembly-line-guide.md"),
      blocker: prompt.includes("or an INFEASIBILITY"),
    }).toEqual({ category: true, searched: true, guide: true, blocker: true });
  });

  it("has spec-write commit only when every named mechanism exists or is tasked, every listed file has a task, same-file tasks chain and each task names its test", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      readsGuide: prompt.includes("4. `.lore/assembly-line-guide.md`"),
      mechanismExistsOrTasked: prompt.includes(
        "exists in this repository — you searched for it — or a tasks.md task creates it",
      ),
      everyListedFile: prompt.includes(
        "every file the plan artifact's Project Structure lists is changed by at least one task",
      ),
      mustNotHingeOnOpenQuestion: prompt.includes(
        "no MUST requirement depends on an answer its own Open Questions still ask",
      ),
      sameFileChained: prompt.includes(
        "tasks that edit the same file are chained with `(depends on …)`",
      ),
      namedTest: prompt.includes("`— test: …`"),
    }).toEqual({
      readsGuide: true,
      mechanismExistsOrTasked: true,
      everyListedFile: true,
      mustNotHingeOnOpenQuestion: true,
      sameFileChained: true,
      namedTest: true,
    });
  });

  it("has feature-decompose file storyless phases as Setup and foundation / Polish stories, chain same-file tasks and name a runnable test", () => {
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      setupStory: prompt.includes('"Setup and foundation"'),
      polishStory: prompt.includes('"Polish"'),
      foldedIntoFirstStory: prompt.includes("belongs to the first user story"),
      sameFileChained: prompt.includes(
        "Tasks that edit the same `file_path` get `depends_on` the earlier one",
      ),
      noManualTest: prompt.includes("never a manual step"),
    }).toEqual({
      setupStory: true,
      polishStory: true,
      foldedIntoFirstStory: false,
      sameFileChained: true,
      noManualTest: true,
    });
  });

  it("keeps every repository path the assembly-line guide names real, so it cannot send a planner to a file that moved", () => {
    const root = new URL("../../../../../../", import.meta.url).pathname;
    const guide = readFileSync(`${root}.lore/assembly-line-guide.md`, "utf8");
    const paths = [
      ...guide.matchAll(/`((?:libs|apps)\/[^`<>\s]+?\.(?:ts|md))`/g),
    ].map((match) => match[1]);

    expect({
      named: paths.length > 5,
      missing: paths.filter((p) => !existsSync(`${root}${p}`)),
    }).toEqual({ named: true, missing: [] });
  });
});
