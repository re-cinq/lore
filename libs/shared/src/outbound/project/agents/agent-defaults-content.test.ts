import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DELIVERING_PROMPT_REFS } from "../../../domain/task-types/delivering-recipes.js";
import { loadAgentDefaults } from "./agent-defaults-files.js";

const SHIPPED = new Map(loadAgentDefaults().map((def) => [def.name, def]));
const LINTING_RECIPES: readonly string[] = [
  "loop-dod",
  "loop-tdd-round",
  "loop-fix-ci",
  "loop-sync",
  "spec-draft",
  "spec-rework",
  "spec-upkeep-update-specs",
  "spec-upkeep-fix-ci",
  "onboard-author",
  "onboard-fix-ci",
  "code-review-refine",
];
const REVIEWING_RECIPES: readonly string[] = [
  "code-review",
  "code-review-recheck",
];

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

  it("tells every delivering recipe to configure the pod's git identity to match the Floor", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name);

      expect(prompt, name).toContain(
        "git config --global user.name 'Lore Agent'",
      );
      expect(prompt, name).toContain(
        "git config --global user.email 'lore-agent@re-cinq.com'",
      );
    }
  });

  it("tells every delivering recipe to format the files it changed, and the ones that do not write code never to run the linter", () => {
    for (const name of DELIVERING_PROMPT_REFS) {
      const prompt = promptOf(name).replace(/\s+/g, " ");
      const lints = LINTING_RECIPES.includes(name);

      expect(prompt, name).toContain(
        "run the repository's FORMATTER over the files you changed",
      );
      expect(prompt.includes("Do NOT run the linter in this pod"), name).toBe(
        !lints,
      );
    }
  });

  it("tells the loop's own recipes that CI judges the branch, so none re-runs the suite in a pod", () => {
    for (const name of ["loop-dod", "loop-tdd-round", "loop-fix-ci"]) {
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
    for (const name of ["loop-dod", "loop-tdd-round"]) {
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

  it("has the loop's own recipes demand red before green", () => {
    expect({
      redFirst: promptOf("loop-dod").includes("FAIL right now"),
      oneRedTest: promptOf("loop-tdd-round").includes(
        "one failing test for the smallest facet",
      ),
    }).toEqual({ redFirst: true, oneRedTest: true });
  });

  it("has tdd-round ask which tests already cover a symbol before editing it", () => {
    const round = promptOf("loop-tdd-round");

    expect(round).toContain("tests_covering");
    expect(round).toContain("REGRESSION");
  });

  it("has tdd-round run only the tests its branch created, the acceptance tests among them, and leave every other test to CI", () => {
    const round = promptOnOneLine("loop-tdd-round");

    expect({
      branchTestsOnly: round.includes("RUN ONLY THE TESTS THIS BRANCH CREATED"),
      acceptanceBeforePush: round.includes(
        "run the acceptance tests before you push",
      ),
      neverMainTests: round.includes("Never run a test main already had"),
      oldAcceptanceBan: round.includes(
        "Never run the acceptance tests `.lore/dod.md` lists",
      ),
    }).toEqual({
      branchTestsOnly: true,
      acceptanceBeforePush: true,
      neverMainTests: true,
      oldAcceptanceBan: false,
    });
  });

  it("has dod write acceptance tests to files of their own, which the branch's rounds run by name", () => {
    expect(promptOnOneLine("loop-dod")).toContain(
      "in a NEW test file of their own",
    );
  });

  it("has dod name every acceptance test file with the .acceptance.test suffix, never as an example", () => {
    const dod = promptOnOneLine("loop-dod");

    expect({
      required: dod.includes("Its name MUST end in `.acceptance.test.<ext>`"),
      optional: dod.includes("or the repository's equivalent suffix"),
    }).toEqual({ required: true, optional: false });
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

describe("LORE_TEST_POLICY", () => {
  it("sets none on every read-only review recipe, so a review pod cannot run tests, installs or builds at all", () => {
    const readOnly = ["code-review", "code-review-recheck"];

    expect(
      readOnly.map((name) => SHIPPED.get(name)?.config?.env?.LORE_TEST_POLICY),
    ).toEqual(readOnly.map(() => "none"));
  });
});

describe("the feature-planning recipe", () => {
  it("tells the planning agent its reader is a product manager, so it names no file, setting, version or route and never writes the marker a check taught it", () => {
    const prompt = promptOnOneLine("plan-analyze");

    expect({
      reader: prompt.includes("read by product managers"),
      noCode: prompt.includes(
        "Never name a file path, a function, a variable, a setting name, a library or its version, a chart key, a route, a table or a command",
      ),
      researchStays: prompt.includes(
        "put the conclusion in the plan in plain words",
      ),
      decisionsNotBuild: prompt.includes("not how to build it"),
      noMarker: prompt.includes('Never write "(this feature adds it)"'),
      plainGather: prompt.includes("in the words a product manager uses"),
      noFileNaming: !prompt.includes(
        "Name the entity or file each claim rests on",
      ),
    }).toEqual({
      reader: true,
      noCode: true,
      researchStays: true,
      decisionsNotBuild: true,
      noMarker: true,
      plainGather: true,
      noFileNaming: true,
    });
  });

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

  it("hands the spec-rework recipe the analysis through a {spec_plan} slot and tells it to amend the statements named there rather than guess from plan.md (#2175)", () => {
    const prompt = promptOnOneLine("spec-rework");

    expect({
      slot: promptOf("spec-rework").includes("{spec_plan_path}"),
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
      specOnly: prompt.includes("is not your question"),
      noRepoLookup: prompt.includes("check it exists in the repository"),
    }).toEqual({
      blind: true,
      noPlan: true,
      reasons: true,
      quotes: true,
      verbatim: true,
      expectedHidden: false,
      specOnly: true,
      noRepoLookup: false,
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

  it("has spec-write return a patch for its one section and edit nothing, bring technical facts only when told they are required, and fix only the failures tagged with its section", () => {
    const prompt = promptOnOneLine("spec-write");

    expect({
      item: promptOf("spec-write").includes("{item}"),
      patchFile: promptOf("spec-write").includes("{section_patch_path}"),
      patch: prompt.includes("you return a PATCH"),
      readOnly: prompt.includes("read-only") && !prompt.includes("git push"),
      required: prompt.includes("Technical additions: required"),
      noFiller: prompt.includes("add no filler"),
      ownSection: prompt.includes("tagged with your section"),
      operations:
        prompt.includes('"op":"append"') && prompt.includes('"op":"amend"'),
      opNamesItsFile: prompt.includes('"file":"<the spec\'s path>"'),
      repairNamesTheFindingsSpec: prompt.includes(
        "Put that path in the `file` of the op that fixes it",
      ),
      oldRetryRule: prompt.includes(
        'end it with `LORE_NODE_RESULT: {"outcome":"changes_requested"}`',
      ),
    }).toEqual({
      item: true,
      patchFile: true,
      patch: true,
      readOnly: true,
      required: true,
      noFiller: true,
      ownSection: true,
      operations: true,
      opNamesItsFile: true,
      repairNamesTheFindingsSpec: true,
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
      specOnly: prompt.includes("is not your question"),
      noRepoLookup: prompt.includes("check it exists in the repository"),
    }).toEqual({
      blind: true,
      out: true,
      noFirstAnswers: true,
      noPlan: true,
      quotes: true,
      specOnly: true,
      noRepoLookup: false,
    });
  });

  it("has the spec-rework recipe fill the spec-kit artifact set from the in-repo templates and convert every NEEDS CLARIFICATION marker to a plan question", () => {
    const prompt = promptOnOneLine("spec-rework");

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

  it("has the spec-tickets-decompose recipe transcribe a reviewed tasks.md instead of re-deriving a breakdown", () => {
    const prompt = promptOnOneLine("spec-tickets-decompose");

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

  it("tells the spec-rework recipe to answer a spec review item by item — amend what the plan settled, send what contradicts it to the plan as a question — and to always write spec-review-result.json", () => {
    const prompt = promptOnOneLine("spec-rework");

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
      fixedTextSaysWhatItTells: prompt.includes(
        "says what the text tells the user",
      ),
      stringsAreTheSpecs: prompt.includes("the exact string is the spec's"),
      newWireNamesNoFields: !prompt.includes("names its fields"),
      newStoreRetention: prompt.includes("retention and erasure"),
      verifiedClaimNamesTarget: prompt.includes("verified against"),
      severity: prompt.includes("severity"),
      success: prompt.includes('LORE_NODE_RESULT: {"outcome":"success"}'),
    }).toEqual({
      readsPlan: true,
      writesValidation: true,
      neverEdits: true,
      standingFindingById: true,
      fixedTextSaysWhatItTells: true,
      stringsAreTheSpecs: true,
      newWireNamesNoFields: true,
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

  it("has plan-validate expect no mechanism names from the plan, and warn on a sentence written for the code rather than its people", () => {
    const prompt = promptOnOneLine("plan-validate");

    expect({
      noMechanismExpected: prompt.includes(
        "The plan is not expected to name the mechanism",
      ),
      category: prompt.includes("**WRITTEN FOR THE CODE**"),
      warning: prompt.includes("written for the code, not for its people"),
    }).toEqual({ noMechanismExpected: true, category: true, warning: true });
  });

  it("has spec-rework commit only when every named mechanism exists or is tasked, every listed file has a task, same-file tasks chain and each task names its test", () => {
    const prompt = promptOnOneLine("spec-rework");

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

  it("has spec-tickets-decompose file storyless phases as Setup and foundation / Polish stories, chain same-file tasks and name a runnable test", () => {
    const prompt = promptOnOneLine("spec-tickets-decompose");

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

  it("has spec-rework rewrite every statement listed under Not on main from the code on its branch", () => {
    const prompt = promptOnOneLine("spec-rework");

    expect({
      heading: prompt.includes('lists names under "Not on main"'),
      fromCode: prompt.includes(
        "read the file it names, or search the clone, and rewrite the statement from what the code says",
      ),
      neverKeep: prompt.includes("Never keep a name the code does not have"),
    }).toEqual({ heading: true, fromCode: true, neverKeep: true });
  });

  it("has spec-rework split a compound requirement one MUST per statement and back an unbacked success criterion", () => {
    const prompt = promptOnOneLine("spec-rework");

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

  it("has spec-tickets-decompose rewrite each task listed under Not on main from the code", () => {
    const prompt = promptOnOneLine("spec-tickets-decompose");

    expect({
      heading: prompt.includes('lists task ids under "Not on main"'),
      fromCode: prompt.includes(
        "rewrite that task from the code on the branch",
      ),
    }).toEqual({ heading: true, fromCode: true });
  });

  it("has spec-tickets-decompose read the spec its spec_path value names, and keep the ids of the tickets filed for it before", () => {
    const prompt = promptOnOneLine("spec-tickets-decompose");

    expect({
      spec: prompt.includes("The spec** is `{spec_path}`"),
      noSearch: prompt.includes("Do not search the clone for another one"),
      existing: prompt.includes("`{existing_tickets_path}`"),
      neverReuse: prompt.includes("never reuse the id of a task you drop"),
    }).toEqual({
      spec: true,
      noSearch: true,
      existing: true,
      neverReuse: true,
    });
  });

  it("has spec-tickets-decompose name each task's spec lines at the commit it read, and on a coverage round add only the statements listed", () => {
    const prompt = promptOnOneLine("spec-tickets-decompose");

    expect({
      lines: prompt.includes(
        '"spec_lines": { "specs/<slug>/spec.md": [42, 57] }',
      ),
      commit: prompt.includes("git -C /workspace/target show {merge_sha}"),
      everyStatement: prompt.includes(
        "Name every testable statement in at least one task",
      ),
      keepsIds: prompt.includes(
        "Keep a task's id when it is still the same work",
      ),
      onlyListed: prompt.includes("this round is for exactly those"),
    }).toEqual({
      lines: true,
      commit: true,
      everyStatement: true,
      keepsIds: true,
      onlyListed: true,
    });
  });

  it("lists remove-section in the plan-analyze op catalogue, only on a person's ask or an empty template section, never for intent or success criteria", () => {
    const prompt = promptOnOneLine("plan-analyze");

    expect({
      op: prompt.includes('`remove-section` `{slot: "…"}`'),
      onRequest: prompt.includes("only when a person asked for it"),
      protectedSections: prompt.includes(
        '"What we want and why" and "Success criteria" can never be removed',
      ),
      noLongerForbidden: prompt.includes("Never remove a section"),
    }).toEqual({
      op: true,
      onRequest: true,
      protectedSections: true,
      noLongerForbidden: false,
    });
  });
});

describe("the loop's recipes on a repository whose toolchain the pod lacks", () => {
  it("has dod, tdd-round and fix-ci leave a toolchain the pod lacks to CI instead of hunting for one", () => {
    const dod = promptOnOneLine("loop-dod");
    const round = promptOnOneLine("loop-tdd-round");
    const fix = promptOnOneLine("loop-fix-ci");

    expect({
      dodLeavesIt: dod.includes("do not look for it and do not install it"),
      dodRedBarIsCis: dod.includes("the red bar is CI's to show"),
      roundLeavesIt: round.includes("do not look for it and do not install it"),
      fixLeavesIt: fix.includes("do not look for it and do not install it"),
    }).toEqual({
      dodLeavesIt: true,
      dodRedBarIsCis: true,
      roundLeavesIt: true,
      fixLeavesIt: true,
    });
  });
});

describe("the loop's branch sync", () => {
  it("tells loop-sync to rebase onto origin/main, push with a lease, never merge, abort an unfinished rebase and never run CI's checks in the pod", () => {
    const prompt = promptOf("loop-sync").replace(/\s+/g, " ");

    expect({
      rebases: prompt.includes("git rebase origin/main"),
      leases: prompt.includes("git push --force-with-lease origin HEAD"),
      neverMerges: prompt.includes("Rebase, never merge"),
      aborts: prompt.includes("git rebase --abort"),
      noChecks: prompt.includes(
        "Do NOT run a typecheck, a build, or the test suite in this pod",
      ),
    }).toEqual({
      rebases: true,
      leases: true,
      neverMerges: true,
      aborts: true,
      noChecks: true,
    });
  });

  it("tells every agent that delivers a branch to rebase it onto main with a lease and never to merge main in", () => {
    for (const name of ["loop-dod", "loop-tdd-round", "loop-fix-ci"]) {
      const prompt = promptOf(name).replace(/\s+/g, " ");

      expect(prompt, name).toContain("git rebase origin/main");
      expect(prompt, name).toContain("git push --force-with-lease origin HEAD");
      expect(prompt, name).not.toContain("merge `origin/main` in");
    }
  });
});

describe("the loop's branch sync on its own scaffolding", () => {
  it("tells loop-sync to settle a conflict on .lore/dod.md as the branch tip has it instead of aborting", () => {
    const prompt = promptOf("loop-sync").replace(/\s+/g, " ");

    expect({
      keepsTip: prompt.includes(
        "`.lore/dod.md`: keep the file as `$TIP` has it",
      ),
      onlyOtherFilesAbort: prompt.includes(
        "a file of the ticket's other than `.lore/dod.md`",
      ),
    }).toEqual({ keepsTip: true, onlyOtherFilesAbort: true });
  });
});

describe("the loop's branch sync keeps both sides' work", () => {
  it("tells loop-sync to rebuild a conflicting branch as one commit of its net change, carrying the replaced commits' trailers", () => {
    const prompt = promptOf("loop-sync").replace(/\s+/g, " ");

    expect({
      squashes: prompt.includes("git merge --squash"),
      trailers: prompt.includes("%(trailers:only,unfold)"),
    }).toEqual({ squashes: true, trailers: true });
  });

  it("tells loop-sync to keep both sides' additions, keep main's copy of what a sibling already merged, and leave a resolution to CI instead of aborting", () => {
    const prompt = promptOf("loop-sync").replace(/\s+/g, " ");

    expect({
      keepsBoth: prompt.includes("keep both, each once"),
      keepsMains: prompt.includes("keep main's and drop the duplicate"),
      ciJudges: prompt.includes(
        "is never a reason to abort: CI judges the push",
      ),
    }).toEqual({ keepsBoth: true, keepsMains: true, ciJudges: true });
  });
});

describe("the recipes that write files lint what they changed", () => {
  it("tells every recipe that writes files to run eslint --fix with a 3 GB heap over the files it changed, one package per call, never over the whole repository", () => {
    for (const name of LINTING_RECIPES) {
      const prompt = promptOnOneLine(name);

      expect(
        {
          lintsChanged: prompt.includes(
            "`NODE_OPTIONS=--max-old-space-size=3072 timeout 300 npx --no-install eslint --fix <files>`",
          ),
          onePackage: prompt.includes("one package per call"),
          neverWholeRepo: prompt.includes("Never lint the whole repository"),
          installsFirst: prompt.includes("install the dependencies first"),
          runsNoTests: prompt.includes("Linting is not testing"),
          forbidsLint: /(not|never) run (the|a) linter/i.test(prompt),
        },
        name,
      ).toEqual({
        lintsChanged: true,
        onePackage: true,
        neverWholeRepo: true,
        installsFirst: true,
        runsNoTests: true,
        forbidsLint: false,
      });
    }
  });

  it("lets the reviewers lint the changed files without --fix to confirm a finding, after reading CI's verdict", () => {
    for (const name of REVIEWING_RECIPES) {
      const prompt = promptOnOneLine(name);

      expect(
        {
          lints: prompt.includes(
            "`NODE_OPTIONS=--max-old-space-size=3072 timeout 300 npx --no-install eslint <files>`",
          ),
          onePackage: prompt.includes("one package per call"),
          neverFixes: prompt.includes("Never `--fix`"),
          forbidsEslint: prompt.includes("do not run eslint"),
        },
        name,
      ).toEqual({
        lints: true,
        onePackage: true,
        neverFixes: true,
        forbidsEslint: false,
      });
    }
  });
});

describe("the formatter and linter commands every recipe names", () => {
  it("names no formatter or linter through npx without --no-install, which the pod's guard refuses", () => {
    const downloading = [...SHIPPED.keys()].filter((name) =>
      /npx (prettier|eslint|biome|ruff|black)\b/.test(promptOf(name)),
    );

    expect(downloading).toEqual([]);
  });
});

describe("the spec tickets decompose on work outside the repository", () => {
  it("has spec-tickets-decompose set needs_person only on a task the loop cannot do from a checkout of the repo, in a task of its own", () => {
    const prompt = promptOnOneLine("spec-tickets-decompose");

    expect({
      field: prompt.includes('"needs_person": "<'),
      outsideRepo: prompt.includes(
        "only on a task the implementation loop cannot do from a checkout of this repository",
      ),
      codeIsLoops: prompt.includes("Never set it on code, tests, docs"),
      ownTask: prompt.includes("Give that step a task of its own"),
    }).toEqual({
      field: true,
      outsideRepo: true,
      codeIsLoops: true,
      ownTask: true,
    });
  });
});
