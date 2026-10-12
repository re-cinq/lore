import { describe, expect, it } from "vitest";
import { GROUND_PREFIX } from "../plan-findings-ops.js";
import { planGroundFindings, slotOfLine } from "./findings.js";

const PLAN_MD = `# Issue triage Assembly Line

## What we want and why <!-- slot:intent -->

Adopt the triage front half of the Cloudflare pattern.

## Platform work this line needs <!-- slot:custom-platform-work -->

Map it to this line (\`assemblyLineFor\` in \`apps/floor/src/work/task/dispatch-agent-cr.ts\`).

Edge selection in \`libs/assembly-lines/src/transition.ts\`.
`;

const FINDINGS = [
  { name: "apps/floor", kind: "retired" as const, line: 11, hint: "deleted" },
  {
    name: "libs/assembly-lines/src/transition.ts",
    kind: "path" as const,
    line: 13,
  },
];

function found(findings = FINDINGS) {
  return planGroundFindings(PLAN_MD, { path: "plan.md", findings });
}

describe("slotOfLine", () => {
  it("answers the slot whose marker precedes the line, and none for a line above every marker", () => {
    expect({
      inPlatformWork: slotOfLine(PLAN_MD, 11),
      inIntent: slotOfLine(PLAN_MD, 5),
      aboveAll: slotOfLine(PLAN_MD, 1),
    }).toEqual({
      inPlatformWork: "custom-platform-work",
      inIntent: "intent",
      aboveAll: null,
    });
  });
});

describe("planGroundFindings", () => {
  it("puts each finding on the slot whose section names it", () => {
    expect(found().map((finding) => finding.slot)).toEqual([
      "custom-platform-work",
      "custom-platform-work",
    ]);
  });

  it("blocks on a retired component and warns on a path that is merely gone", () => {
    expect(found().map((finding) => finding.severity)).toEqual([
      "blocker",
      "warning",
    ]);
  });

  it("keys a finding on its slot and the name, so the same stale name is one finding on every pass", () => {
    const first = found();
    const again = found();

    expect({
      ids: first.map((finding) => finding.finding_id),
      stable: again.map((finding) => finding.finding_id),
      prefixed: first.every((finding) =>
        finding.finding_id?.startsWith(GROUND_PREFIX),
      ),
    }).toEqual({
      ids: first.map((finding) => finding.finding_id),
      stable: first.map((finding) => finding.finding_id),
      prefixed: true,
    });
  });

  it("reports one finding for a name two statements of a section both name", () => {
    const twice = [...FINDINGS, { ...FINDINGS[0]!, line: 13 }];

    expect(
      planGroundFindings(PLAN_MD, { path: "plan.md", findings: twice }),
    ).toHaveLength(2);
  });

  it("names the stale path in the finding and asks for the name to go in its why, never for a marker", () => {
    expect(found()[1]).toMatchObject({
      text: expect.stringContaining("libs/assembly-lines/src/transition.ts"),
      why: expect.stringContaining(
        "is not on main, so a spec written from this section would describe code that does not exist. Rewrite the statement in plain words without the name: a plan says what changes for its people, and the spec names the files.",
      ),
    });
    expect(found()[1].why).not.toContain("this feature adds it");
  });

  it("leaves a settled question, its answer and a comment alone, and still reports the same path in the section's own prose", () => {
    const discussed = [
      "# Sign in",
      "",
      "## In and out of scope <!-- slot:scope -->",
      "",
      "> **Question** (q-workspace-name): Which workspace name: `apps/dummy-idp` or `apps/oidc-provider`?",
      "> **Answer**: apps/dummy-idp",
      "> **Comment** by bogdan (resolved): keep `apps/dummy-idp` out of the picker",
      "> **Finding** (f-ground-1, warning): This section names `apps/oidc-provider`.",
      "",
      "- The stand-in provider is a workspace of its own, `apps/dummy-idp`.",
      "",
    ].join("\n");
    const onEveryLine = (line: number) => [
      { name: "apps/dummy-idp", kind: "path" as const, line },
      { name: "apps/oidc-provider", kind: "path" as const, line },
    ];

    expect(
      planGroundFindings(discussed, {
        path: "plan.md",
        findings: [
          ...[5, 6, 7, 8].flatMap(onEveryLine),
          { name: "apps/dummy-idp", kind: "path" as const, line: 10 },
        ],
      }).map(({ slot, text }) => ({ slot, text })),
    ).toEqual([
      {
        slot: "scope",
        text: "This section names `apps/dummy-idp`, which is not on the default branch.",
      },
    ]);
  });

  it("reports nothing when the plan carries no slot markers to attach a finding to", () => {
    expect(
      planGroundFindings("# Plan\n\nNo markers here.\n", {
        path: "plan.md",
        findings: FINDINGS,
      }),
    ).toEqual([]);
  });
});
