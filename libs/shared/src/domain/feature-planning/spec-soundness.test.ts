import { describe, expect, it } from "vitest";
import {
  soundnessBrief,
  specSoundness,
  type SoundnessFinding,
} from "./spec-soundness.js";

const SPEC = `# Feature Specification: Triage

| Field  | Value       |
|--------|-------------|
| Status | In Progress |

The line triages an issue before anyone implements it.

## Requirements

- **FR1**: The eight \`triage:*\` labels MUST be created by \`enrol-repo.ts\`, and a \`triage_label\` station MUST apply the one matching each outcome.
- **FR2**: The \`reproduce\` station MUST run the reproduction in a pod and report \`triage: reproduced\` when the bug shows.

## Success Criteria

- **SC-001**: Runs reaching \`triage: reproduced\` increase.
- **SC-002**: Backlog trend decreases.
- **SC-003**: Issues reaching \`triage: archived\` decrease.
`;

function findings(text = SPEC): SoundnessFinding[] {
  return specSoundness([{ path: "specs/triage/spec.md", text }]);
}

function rulesOn(statement: string): string[] {
  return findings()
    .filter((finding) => finding.statement.startsWith(statement))
    .map((finding) => finding.rule);
}

describe("specSoundness — a requirement carrying more than one MUST", () => {
  it("reports compound-requirement for the FR naming both the labels and the station", () => {
    expect(
      findings().filter((f) => f.rule === "compound-requirement"),
    ).toMatchObject([
      {
        path: "specs/triage/spec.md",
        rule: "compound-requirement",
        detail: expect.stringContaining("2"),
      },
    ]);
  });

  it("reports nothing for a requirement with one MUST", () => {
    expect(rulesOn("**FR2**")).toEqual([]);
  });

  it("counts the MUSTs of the statement alone, not of its trailing link group", () => {
    const linked = SPEC.replace(
      "run the reproduction in a pod.",
      "run the reproduction in a pod. ([validated by the pod MUST be dedicated](apps/x.test.ts#L4))",
    );

    const compound = specSoundness([
      { path: "specs/triage/spec.md", text: linked },
    ]).filter((found) => found.rule === "compound-requirement");

    expect(compound).toMatchObject([
      { statement: expect.stringContaining("**FR1**") },
    ]);
  });
});

describe("specSoundness — a success criterion with nothing behind it", () => {
  it("reports nothing for a criterion naming a state a requirement defines", () => {
    expect(rulesOn("**SC-001**")).toEqual([]);
  });

  it("reports unbacked-criterion for a criterion naming nothing measurable", () => {
    expect(rulesOn("**SC-002**")).toEqual(["unbacked-criterion"]);
  });

  it("reports unbacked-criterion for a criterion naming a state no requirement defines", () => {
    expect(rulesOn("**SC-003**")).toEqual(["unbacked-criterion"]);
  });
});

describe("soundnessBrief", () => {
  it("writes a section per rule, naming the spec and the line, and nothing for no findings", () => {
    const brief = soundnessBrief(findings());

    expect({
      compound: brief.includes("## Compound requirements"),
      unbacked: brief.includes("## Unbacked success criteria"),
      located: brief.includes("specs/triage/spec.md"),
      clean: soundnessBrief([]),
    }).toEqual({
      compound: true,
      unbacked: true,
      located: true,
      clean: "",
    });
  });
});
