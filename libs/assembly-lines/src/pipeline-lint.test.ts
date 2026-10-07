import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { shippedAgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { describe, expect, it } from "vitest";
import { pipelineProblems, type PipelineProblem } from "./pipeline-lint.js";

const prompts = shippedAgentPrompts();

function problems(yamlText: string): PipelineProblem[] {
  return pipelineProblems(yamlText, prompts);
}

function rules(yamlText: string): string[] {
  return problems(yamlText).map((problem) => problem.rule);
}

const ONE_LABEL_NODE_FOR_EVERY_VERDICT = `
line:
  id: triage
  entry: reproduce
  exit: done
  args:
    issue_url:
      kind: value
      subject: true
  nodes:
    - id: reproduce
      station: triage-reproduce
    - id: triage-label
      station: triage-label
    - id: diagnose
      station: triage-reproduce
    - id: done
  edges:
    - from: reproduce
      to: triage-label
      on: success
    - from: triage-label
      to: diagnose
      on: success
    - from: triage-label
      to: done
      on: success
    - from: diagnose
      to: done
      on: success
stations:
  triage-reproduce:
    kind: service
    outcomes:
      - success
    needs: []
    produces: []
  triage-label:
    kind: service
    outcomes:
      - success
    needs: []
    produces: []
`;

const SOUND = `
line:
  id: sound
  entry: work
  exit: done
  args:
    issue_url:
      kind: value
      subject: true
  nodes:
    - id: work
      station: work
    - id: done
  edges:
    - from: work
      to: done
      on: success
    - from: work
      to: done
      on: failed
stations:
  work:
    kind: service
    outcomes:
      - success
      - failed
    needs: []
    produces: []
`;

const FEATURE_DECOMPOSE_REUSED = `
line:
  id: triage
  entry: decompose
  exit: done
  args:
    issue_url:
      kind: value
      subject: true
  nodes:
    - id: decompose
      station: decompose
    - id: done
  edges:
    - from: decompose
      to: done
      on: always
stations:
  decompose:
    kind: agent
    agent_definition: feature-decompose
    outcomes:
      - success
    needs: []
    produces: []
`;

const DECOMPOSE_INPUTS_DECLARED = FEATURE_DECOMPOSE_REUSED.replace(
  "    needs: []\n    produces: []\n",
  `    needs:
      - name: spec_plan
        kind: file
        path: spec-plan.json
      - name: plan_md
        kind: file
        path: plan.md
      - name: spec_path
        kind: value
    produces:
      - name: decomposition
        kind: file
        path: decomposition.json
`,
);

describe("pipelineProblems — the edges a node routes", () => {
  it("reports ambiguous-edge for the issue-triage topology where every verdict routes into one triage-label node", () => {
    expect(problems(ONE_LABEL_NODE_FOR_EVERY_VERDICT)).toMatchObject([
      {
        line: "triage",
        node: "triage-label",
        rule: "ambiguous-edge",
        detail: expect.stringContaining("success"),
      },
    ]);
  });

  it("reports nothing for a line whose every node routes each outcome once", () => {
    expect(problems(SOUND)).toEqual([]);
  });

  it("reports outcome-without-edge for a declared outcome no edge routes", () => {
    const unrouted = SOUND.replace(
      "    - from: work\n      to: done\n      on: failed\n",
      "",
    );

    expect(problems(unrouted)).toMatchObject([
      {
        line: "sound",
        node: "work",
        rule: "outcome-without-edge",
        detail: expect.stringContaining("failed"),
      },
    ]);
  });

  it("reports nothing for a node that routes always instead of naming each outcome", () => {
    const always = SOUND.replace(
      "      on: failed",
      "      on: always",
    ).replace("    - from: work\n      to: done\n      on: success\n", "");

    expect(problems(always)).toEqual([]);
  });
});

describe("pipelineProblems — the subject a line keys its runs on", () => {
  it("reports unkeyed-line when no arg carries subject: true", () => {
    expect(rules(SOUND.replace("      subject: true\n", ""))).toEqual([
      "unkeyed-line",
    ]);
  });

  it("reports unkeyed-line naming both args when two carry subject: true", () => {
    const two = SOUND.replace(
      "    issue_url:\n      kind: value\n      subject: true\n",
      "    issue_url:\n      kind: value\n      subject: true\n    repo:\n      kind: value\n      subject: true\n",
    );

    expect(problems(two)).toMatchObject([
      {
        line: "sound",
        rule: "unkeyed-line",
        detail: expect.stringContaining("issue_url, repo"),
      },
    ]);
  });
});

describe("pipelineProblems — the inputs an agent's recipe reads", () => {
  it("reports unsupplied-input naming spec_path when a line reuses feature-decompose and supplies none of its inputs", () => {
    const found = problems(FEATURE_DECOMPOSE_REUSED);

    expect(found).toMatchObject([
      { line: "triage", node: "decompose", rule: "unsupplied-input" },
    ]);
    expect(found[0]?.detail).toContain("spec_path");
  });

  it("reports nothing when a need supplies the placeholder, counting a _path suffix as the bag item's name", () => {
    expect(rules(DECOMPOSE_INPUTS_DECLARED)).toEqual([]);
  });
});

const DEAD_END = `
line:
  id: triage
  entry: reproduce
  exit: done
  args:
    issue_url:
      kind: value
      subject: true
  nodes:
    - id: reproduce
      station: reproduce
    - id: triage-label
    - id: done
  edges:
    - from: reproduce
      to: triage-label
      on: success
    - from: reproduce
      to: triage-label
      on: skipped
stations:
  reproduce:
    kind: agent
    outcomes:
      - success
      - skipped
    needs: []
    produces: []
`;

describe("pipelineProblems — where a run can get to", () => {
  it("reports dead-end for the issue-triage label node every verdict routes into and nothing leaves, and unreachable for the exit it strands", () => {
    expect(problems(DEAD_END)).toMatchObject([
      {
        line: "triage",
        node: "triage-label",
        rule: "dead-end",
        detail: expect.stringContaining("no edge leaves it"),
      },
      { node: "done", rule: "unreachable" },
    ]);
  });

  it("reports nothing for the exit node, which is where a run is meant to stop", () => {
    expect(rules(SOUND)).toEqual([]);
  });

  it("reports unreachable for a node no edge and no start event reaches", () => {
    const orphan = SOUND.replace(
      "    - id: done\n",
      "    - id: orphan\n      station: work\n    - id: done\n",
    ).replace(
      "    - from: work\n      to: done\n      on: failed\n",
      `    - from: work
      to: done
      on: failed
    - from: orphan
      to: done
      on: always
`,
    );

    expect(problems(orphan)).toMatchObject([
      { node: "orphan", rule: "unreachable" },
    ]);
  });

  it("reports nothing for a node its own start event reaches, as feature-planning's validate is entered", () => {
    const byHand = SOUND.replace(
      "    - id: done\n",
      "    - id: validate\n      station: work\n      start: manual.plan.validate\n    - id: done\n",
    ).replace(
      "    - from: work\n      to: done\n      on: failed\n",
      `    - from: work
      to: done
      on: failed
    - from: validate
      to: done
      on: always
`,
    );

    expect(rules(byHand)).toEqual([]);
  });
});

describe("pipelineProblems — the outcomes an edge may route on", () => {
  it("reports undeclared-outcome for an edge leaving on an outcome its station never declares", () => {
    const undeclared = SOUND.replace("      on: failed", "      on: obsolete");
    const found = problems(undeclared);

    expect({
      rules: found.map((problem) => problem.rule).sort(),
      undeclared: found.find(
        (problem) => problem.rule === "undeclared-outcome",
      ),
    }).toMatchObject({
      rules: ["outcome-without-edge", "undeclared-outcome"],
      undeclared: {
        line: "sound",
        node: "work",
        detail: expect.stringContaining("obsolete"),
      },
    });
  });

  it("reports nothing for an always edge, which no station declares", () => {
    const always = SOUND.replace(
      "      on: failed",
      "      on: always",
    ).replace("    - from: work\n      to: done\n      on: success\n", "");

    expect(rules(always)).toEqual([]);
  });
});

describe("pipelineProblems — what the floor requires of a station", () => {
  const NO_BAG = SOUND.replace("    needs: []\n    produces: []\n", "");

  it("reports undeclared-bag naming the station and both missing arrays", () => {
    expect(problems(NO_BAG)).toEqual([
      {
        line: "sound",
        node: undefined,
        rule: "undeclared-bag",
        detail:
          'station "work" declares no needs and no produces; the floor requires both arrays',
      },
    ]);
  });

  it("reports undeclared-bag naming produces alone when needs is declared", () => {
    expect(problems(SOUND.replace("    produces: []\n", ""))).toEqual([
      {
        line: "sound",
        node: undefined,
        rule: "undeclared-bag",
        detail:
          'station "work" declares no produces; the floor requires both arrays',
      },
    ]);
  });

  it("reports nothing for a station whose bag arrays are empty but declared", () => {
    expect(problems(SOUND)).toEqual([]);
  });
});

describe("pipelineProblems — the pipelines Lore ships", () => {
  const directory = path.join(import.meta.dirname, "floor-pipelines");

  it("reports nothing for all eleven pipeline files in floor-pipelines", () => {
    const files = readdirSync(directory).filter((name) =>
      name.endsWith(".yaml"),
    );
    const found = files.flatMap((name) =>
      problems(readFileSync(path.join(directory, name), "utf8")).map(
        (problem) => ({ ...problem, file: name }),
      ),
    );

    expect({ checked: files.length >= 11, found }).toEqual({
      checked: true,
      found: [],
    });
  });
});
