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
  triage-label:
    kind: service
    outcomes:
      - success
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
`;

const DECOMPOSE_INPUTS_DECLARED = FEATURE_DECOMPOSE_REUSED.replace(
  "    outcomes:\n      - success\n",
  `    outcomes:
      - success
    needs:
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
