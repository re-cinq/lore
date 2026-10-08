import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DELIVERING_PROMPT_REFS } from "../../../domain/task-types/delivering-recipes.js";
import { loadAgentDefaults } from "./agent-defaults-files.js";

const SHIPPED = new Map(loadAgentDefaults().map((def) => [def.name, def]));

function promptOf(name: string): string {
  return SHIPPED.get(name)?.prompt ?? "";
}

describe("the delivering recipes", () => {
  it("tells every implementing recipe to commit and push, because the next node is another pod (18/18 implementation-loop branches shipped 0 commits, 2026-08-30)", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name);

      expect(prompt, name).toMatch(
        /git (-C \/workspace\/target )?push origin HEAD/,
      );
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
    for (const name of [
      "loop-dod",
      "loop-tdd-round",
      "loop-fix-ci",
      "loop-pr-ready",
    ]) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain("CI is the judge of this branch");
    }
  });

  it("tells fix-ci to run only the checks the CI report named", () => {
    expect(promptOf("loop-fix-ci")).toContain("run ONLY that");
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
    for (const name of ["loop-dod", "loop-tdd-round", "loop-pr-ready"]) {
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
      (n) => n !== "loop-tdd-round" && n !== "loop-fix-ci",
    );

    for (const name of oneShot) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain('LORE_NODE_RESULT: {"outcome":"failed"}');
    }
  });

  it("lets a round that found the work already done report success, since failure would strand the branch", () => {
    const round = SHIPPED.get("loop-tdd-round");

    expect(round?.prompt).toContain(
      'LORE_NODE_RESULT: {"outcome":"success","extras":{"tdd_next":"acceptance green"}}',
    );
    expect(round?.prompt).toContain(
      "Report failure when you are STUCK, never when you are FINISHED",
    );
  });

  it("holds the DoD to the ticket's own claim — scope fidelity, not reinterpretation (bowman-ui #11, #1745)", () => {
    const dod = promptOf("loop-dod");

    expect(dod).toContain("SCOPE FIDELITY");
    expect(dod).toContain("central claim");
    expect(dod).toContain("fail BECAUSE of that claim");
    expect(dod).toContain("redefined the ticket");
  });

  it("bans acceptance tests whose subject is the repository's own source text (bowman-ui #8/#9/#10, #1743)", () => {
    const dod = promptOf("loop-dod");
    const round = promptOf("loop-tdd-round");

    expect(dod).toContain("real entry point");
    expect(dod).toContain("own source text");
    expect(dod).toContain("compute the value");
    expect(round).toContain("own source text");
  });

  it("asks the definition of done to open with the ticket claim as a blockquote", () => {
    expect(promptOf("loop-dod")).toContain(
      "> <the ticket's central claim, quoted verbatim>",
    );
  });

  it("tells the definition-of-done step its verdict is posted on the issue", () => {
    expect(promptOf("loop-dod")).toContain("posted verbatim on the issue");
  });

  it("asks the definition of done for task-list checkboxes, so a round's progress renders", () => {
    const dod = promptOf("loop-dod");

    expect(dod).toContain("## Done when these pass");
    expect(dod).toContain("- [ ] **<test name>**");
  });

  it("tells a round to tick the facet it closed rather than append to a log", () => {
    expect(promptOf("loop-tdd-round")).toContain("`- [ ]` becomes `- [x]`");
  });

  it("offers a mechanical strategy so a trivial ticket owes no new permanent test (#1744)", () => {
    const dod = promptOf("loop-dod");
    const round = promptOf("loop-tdd-round");

    expect(dod).toContain("`mechanical`");
    expect(dod).toContain("EXISTING tests");
    expect(round).toContain("`mechanical`");
  });

  it("has pr-ready report issue coverage, and leaves the footer to the Floor", () => {
    const ready = promptOf("loop-pr-ready");

    expect(ready).toContain('"issue_coverage"');
    expect(ready).toContain("Refs");
    expect(ready).not.toContain("Closes #");
  });

  it("writes the PR description beside the clone, where Lore reads it and git never sees it", () => {
    const ready = promptOnOneLine("loop-pr-ready");

    expect({
      namesBodyBesideClone: ready.includes("WRITE `{pr_body_path}`"),
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
    const ready = promptOf("loop-pr-ready");

    expect(ready).toContain("rewrite the sentence");
    expect(ready).toContain("never a comment or blank line");
  });

  it("has the loop's own recipes demand red before green, inline validated-by links, and the status flip", () => {
    expect({
      redFirst: promptOf("loop-dod").includes("FAIL right now"),
      oneRedTest: promptOf("loop-tdd-round").includes(
        "one failing test for the smallest facet",
      ),
      links: promptOf("loop-pr-ready").includes(
        "([validated by name](path#Lnn))",
      ),
      status: promptOf("loop-pr-ready").includes("`| Status |` header row"),
    }).toEqual({ redFirst: true, oneRedTest: true, links: true, status: true });
  });

  it("has tdd-round ask which tests already cover a symbol before editing it", () => {
    const round = promptOf("loop-tdd-round");

    expect(round).toContain("tests_covering");
    expect(round).toContain("REGRESSION");
  });

  it("has fix-ci ask what failed on a path before it reads any file", () => {
    const fix = promptOf("loop-fix-ci");

    expect(fix).toContain("failures_touching");
    expect(fix).toContain("still open");
  });
});

describe("the fix-ci recipe and a named failed step", () => {
  it("tells fix-ci to run only the failed step's command when the CI report names one", () => {
    expect(promptOf("loop-fix-ci")).toContain("run only that step's command");
  });
});

describe("the fix-ci recipe when the branch moved", () => {
  it("tells fix-ci to change nothing and report success when commits CI has not judged sit on top of the reported sha", () => {
    const fix = promptOf("loop-fix-ci");

    expect(fix).toContain("..HEAD");
    expect(fix).toContain("the branch moved after CI judged it");
  });
});

describe("test_policy", () => {
  it("declares none on every read-only review recipe, so a review pod cannot run tests, installs or builds at all", () => {
    const readOnly = ["code-review", "loop-pr-ready"];

    expect(
      readOnly.map((name) => SHIPPED.get(name)?.config?.test_policy),
    ).toEqual(readOnly.map(() => "none"));
  });
});

describe("the feature-planning recipe", () => {
  it("tells the planning agent to gather from lore_assemble_context and the lore_query_graph knowledge graph before it writes", () => {
    const prompt = promptOf("plan-analyze");
    const gather = prompt.indexOf("## Gather before you write");

    expect({
      gatherFirst:
        gather >= 0 && gather < prompt.indexOf("## Your deliverable"),
      context: prompt.includes("`lore_assemble_context`"),
      graph: prompt.includes("`lore_query_graph`"),
      trace: prompt.includes("`query_trace`"),
    }).toEqual({ gatherFirst: true, context: true, graph: true, trace: true });
  });

  it("tells the planning agent a finding is work to do, fixed in the section it names and never edited or removed", () => {
    const prompt = promptOnOneLine("plan-analyze");

    expect({
      ownWork: prompt.includes("A finding is not part of the conversation"),
      fixTheSection: prompt.includes(
        "fix the section it names so what it says no longer holds",
      ),
      leaveTheBlock: prompt.includes(
        "Never edit or remove a finding block: the check that wrote it clears it",
      ),
      disagree: prompt.includes(
        "ask with `add-question` on its section and change nothing there",
      ),
      inTheBrief: prompt.includes(
        "A finding reaches you in the brief, never in the plan read",
      ),
    }).toEqual({
      ownWork: true,
      fixTheSection: true,
      leaveTheBlock: true,
      disagree: true,
      inTheBrief: true,
    });
  });

  it("tells the planning agent the Refine it was asked for is in the plan read, outranking the description its node started with", () => {
    const prompt = promptOnOneLine("plan-analyze");

    expect({
      inTheRead: prompt.includes(
        "`lore_plan_read` answers with `refine: {slot, title, brief}`",
      ),
      onlySection: prompt.includes("the only section you were asked to change"),
      outranks: prompt.includes("the `refine` in this read outranks it"),
      noneIsADraft: prompt.includes(
        "answers no `refine`, nobody asked for a section and this is a draft",
      ),
    }).toEqual({
      inTheRead: true,
      onlySection: true,
      outranks: true,
      noneIsADraft: true,
    });
  });

  it("tells the planning agent that Open questions holds only questions, so it never restates its questions there as a list", () => {
    const prompt = promptOnOneLine("plan-analyze");

    expect({
      onlyQuestions: prompt.includes(
        "only when it belongs to no other section. That section holds only questions",
      ),
      noRestating: prompt.includes("never a list, a paragraph, or a copy"),
    }).toEqual({ onlyQuestions: true, noRestating: true });
  });

  it("tells the planning agent its edits land unreviewed, so it checks each claim against the plan's other sections and settled answers and asks rather than contradict one", () => {
    const prompt = promptOnOneLine("plan-analyze");

    expect({
      unreviewed: prompt.includes("nobody accepts them first"),
      checkFirst: prompt.includes(
        "check it against what the plan already decides",
      ),
      askInstead: prompt.includes("ask with `add-question` instead"),
      everyInput: prompt.includes(
        "Write in every settled input the brief lists",
      ),
    }).toEqual({
      unreviewed: true,
      checkFirst: true,
      askInstead: true,
      everyInput: true,
    });
  });

  it("edits the live plan through lore_plan_read and lore_plan_edit instead of uploading a file", () => {
    const prompt = promptOnOneLine("plan-analyze");

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
      slot: promptOf("spec-write").includes("{spec_plan_path}"),
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

  it("has spec-analysis create at most one new spec, update the merged spec that already owns the area instead, and list every older spec the change contradicts as a conflict to adapt", () => {
    const prompt = promptOnOneLine("spec-analysis");

    expect({
      atMostOneCreate: prompt.includes('"creates" holds AT MOST ONE entry'),
      mergedSpecWins: prompt.includes(
        "a merged spec that already owns the area is updated, not shadowed by a new one",
      ),
      conflicts: prompt.includes('begins with "Conflict:"'),
    }).toEqual({
      atMostOneCreate: true,
      mergedSpecWins: true,
      conflicts: true,
    });
  });

  it("has spec-qa-generate write a frozen set once, with an expected value, a severity and a source block per question and a note question per plan comment, answer and open question", () => {
    const prompt = promptOnOneLine("spec-qa-generate");

    expect({
      once: prompt.includes("You write the set ONCE"),
      expected: prompt.includes(
        "`expected` is what a spec that kept the plan answers",
      ),
      source: prompt.includes("`source` is the `id` of the one plan block"),
      notes: prompt.includes(
        "ONE statement for every plan comment, every answer and every open question",
      ),
      neverSeesSpec: prompt.includes("you never see the specification"),
    }).toEqual({
      once: true,
      expected: true,
      source: true,
      notes: true,
      neverSeesSpec: true,
    });
  });

  it("has spec-qa-answer answer from the blind question file alone, never look for the plan, give a reason for every answer, and quote the spec for every answer that upholds a statement", () => {
    const prompt = promptOnOneLine("spec-qa-answer");

    expect({
      blind: promptOf("spec-qa-answer").includes("{qa_blind_path}"),
      noPlan: prompt.includes("must not look for it"),
      reasons: prompt.includes('"reason":'),
      quotes: prompt.includes('"evidence":'),
      verbatim: prompt.includes("copied character for character from the spec"),
      expectedHidden: prompt.includes("expected"),
    }).toEqual({
      blind: true,
      noPlan: true,
      reasons: true,
      quotes: true,
      verbatim: true,
      expectedHidden: false,
    });
  });

  it("has spec-analysis write one bounded repo-context file, and draft and write start from it instead of exploring the repository again", () => {
    const analysis = promptOnOneLine("spec-analysis");

    expect({
      writes: promptOf("spec-analysis").includes("{repo_context_path}"),
      bounded: analysis.includes("at most 24,000 characters"),
      draft: promptOnOneLine("spec-draft").includes(
        "Start from `/workspace/repo-context.md`",
      ),
      write: promptOnOneLine("spec-write").includes(
        "Start from `/workspace/repo-context.md`",
      ),
    }).toEqual({ writes: true, bounded: true, draft: true, write: true });
  });

  it("has spec-write return a section result file, bring technical facts only when told they are required, and fix only the failures tagged with its section", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      result: promptOf("spec-write").includes("{section_result_path}"),
      statuses: prompt.includes("integrated"),
      onlyWhenRequired: prompt.includes("Technical additions: required"),
      noFiller: prompt.includes("add no filler"),
      ownSection: prompt.includes("tagged with your section"),
      oldRetryRule: prompt.includes(
        'end it with `LORE_NODE_RESULT: {"outcome":"changes_requested"}`',
      ),
    }).toEqual({
      result: true,
      statuses: true,
      onlyWhenRequired: true,
      noFiller: true,
      ownSection: true,
      oldRetryRule: false,
    });
  });

  it("has spec-draft build the skeleton from the intent and leave technical detail to the section pods, so the draft invents none", () => {
    const prompt = promptOnOneLine("spec-draft");

    expect({
      mandatory: prompt.includes(
        "A draft that only restates the intent has failed",
      ),
      leaves: prompt.includes(
        "the pods for the other sections bring the technical detail",
      ),
      noInvention: prompt.includes("name nothing that is not on main"),
    }).toEqual({ mandatory: false, leaves: true, noInvention: true });
  });

  it("has spec-qa-recheck give a second opinion on the failed statements alone, without the first answers or the plan, and quote the spec for every true", () => {
    const prompt = promptOnOneLine("spec-qa-recheck");

    expect({
      blind: promptOf("spec-qa-recheck").includes("{qa_recheck_blind_path}"),
      out: promptOf("spec-qa-recheck").includes("{qa_recheck_answers_path}"),
      noFirstAnswers: prompt.includes("you have not seen its answers"),
      noPlan: prompt.includes("must not look for it"),
      quotes: prompt.includes('"evidence":'),
    }).toEqual({
      blind: true,
      out: true,
      noFirstAnswers: true,
      noPlan: true,
      quotes: true,
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
        "Never confuse `{plan_md_path}` (the approved PLANNING DOCUMENT",
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
      addressed: prompt.includes('"action": "addressed"'),
      toPlan: prompt.includes("change NOTHING for it"),
      neverAnswer: prompt.includes("Never answer for the plan's people"),
      always: prompt.includes("Always write `spec-review-result.json`"),
      empty: prompt.includes('{"plan_questions": [], "replies": []}'),
      noChangeIsSuccess: prompt.includes(
        'the specs are right as they stand — `spec-review-result.json` is your delivery, so end with `LORE_NODE_RESULT: {"outcome":"success"}`',
      ),
    }).toEqual({
      addressed: true,
      toPlan: true,
      neverAnswer: true,
      always: true,
      empty: true,
      noChangeIsSuccess: true,
    });
  });
});

function promptOnOneLine(name: string): string {
  return promptOf(name).replace(/\s+/g, " ");
}

describe("the plan-validate recipe", () => {
  it("reads plan.md read-only and writes plan-validation.json, never editing the plan", () => {
    const prompt = promptOnOneLine("plan-validate");

    expect({
      readsPlan: prompt.includes("`lore_plan_read {plan_id}`"),
      writesValidation: prompt.includes("`plan-validation.json`"),
      neverEdits: prompt.includes("Never edit the plan"),
      standingFindingById: prompt.includes("by its id"),
      fixedTextNamesStrings: prompt.includes("names its strings"),
      newWireNamesFields: prompt.includes("names its fields"),
      newStoreRetention: prompt.includes("retention and erasure"),
      verifiedClaimNamesTarget: prompt.includes("verified against"),
      severity: prompt.includes("severity"),
      success: prompt.includes('LORE_NODE_RESULT: {"outcome":"success"}'),
    }).toEqual({
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

describe("the gap-fill recipe", () => {
  it("lets a draft that finds the context already current report changes_requested, so a true no-op ends the run without a PR instead of failing an empty branch", () => {
    const prompt = promptOf("gap-fill");

    expect(prompt).toContain(
      'LORE_NODE_RESULT: {"outcome":"changes_requested","extras":{"Lore-Already-Current":',
    );
    expect(prompt).toContain("Report failure when you are STUCK");
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
        "Tasks that edit the same `file_path` get `depends_on` the immediately preceding one of them in T-id order",
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

  it("has spec-write rewrite every statement listed under Not on main from the code on its branch", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      heading: prompt.includes('lists names under "Not on main"'),
      fromCode: prompt.includes(
        "read the file it names, or search the clone, and rewrite the statement from what the code says",
      ),
      neverKeep: prompt.includes("Never keep a name the code does not have"),
    }).toEqual({ heading: true, fromCode: true, neverKeep: true });
  });

  it("has spec-write split a compound requirement one MUST per statement and back an unbacked success criterion", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      compound: prompt.includes(
        'lists statements under "Compound requirements"',
      ),
      perMust: prompt.includes(
        "Split each listed statement into one requirement per MUST",
      ),
      claimsByLine: prompt.includes("A task claims a statement by"),
      unbacked: prompt.includes(
        'lists statements under "Unbacked success criteria"',
      ),
      defineIt: prompt.includes(
        "add the requirement that defines what it counts",
      ),
    }).toEqual({
      compound: true,
      perMust: true,
      claimsByLine: true,
      unbacked: true,
      defineIt: true,
    });
  });

  it("has feature-decompose rewrite each task listed under Not on main from the code and drop the plan quotes naming what is gone", () => {
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      heading: prompt.includes('lists task ids under "Not on main"'),
      fromCode: prompt.includes(
        "rewrite that task from the code on the branch",
      ),
      dropQuote: prompt.includes(
        "drop a plan quote that names something the code lacks",
      ),
    }).toEqual({ heading: true, fromCode: true, dropQuote: true });
  });

  it("has feature-decompose read the spec its spec_path value names beside the approved plan, and take context from that plan", () => {
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      spec: prompt.includes("The spec** this plan writes is `{spec_path}`"),
      noSearch: prompt.includes("Do not search the clone for another one"),
      context: prompt.includes("take `context` from the approved plan too"),
    }).toEqual({ spec: true, noSearch: true, context: true });
  });

  it("has feature-decompose name each task's spec lines at the commit it read, and on a coverage round add only the statements listed", () => {
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      lines: prompt.includes(
        '"spec_lines": { "specs/<slug>/spec.md": [42, 57], "specs/<other>/spec.md": [12] }',
      ),
      otherSpecs: prompt.includes(
        "statements in every spec `{spec_plan_path}` names count",
      ),
      commit: prompt.includes("git -C /workspace/target rev-parse HEAD"),
      everyStatement: prompt.includes(
        "Name every testable statement in at least one task",
      ),
      keepsIds: prompt.includes(
        "keep every task that is still the same work, with its id",
      ),
      onlyListed: prompt.includes("this round is for exactly those"),
    }).toEqual({
      lines: true,
      otherSpecs: true,
      commit: true,
      everyStatement: true,
      keepsIds: true,
      onlyListed: true,
    });
  });

  it("has feature-decompose read every spec spec-plan.json names, cite the plan blocks, and quote the plan on every task", () => {
    const prompt = promptOnOneLine("feature-decompose");

    expect({
      everySpec: prompt.includes("Read every spec it names"),
      cites: prompt.includes("copied exactly as the file gives it"),
      quotes: prompt.includes("`plan_quotes`"),
    }).toEqual({ everySpec: true, cites: true, quotes: true });
  });
});
