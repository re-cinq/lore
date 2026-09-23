import { describe, it, expect } from "vitest";
import { planToMarkdown, templateFor } from "@re-cinq/planning-document";
import {
  planMeta,
  planWith,
  textBlock,
} from "@re-cinq/planning-document/testing";
import {
  applyPlanFile,
  planMarkdown,
  type PlanFilePorts,
} from "./plan-file.js";

const META = { ...planMeta("feature", "Faster checkout"), id: "p1" };
const BLOCKS = planWith("feature", {
  intent: [textBlock("paragraph", {}, "Checkout is slow.")],
  scope: [textBlock("paragraph", {}, "Only the web checkout.")],
});
const PLAN_MD = planToMarkdown(BLOCKS, templateFor("feature"));

function recordingPorts() {
  const writes: Array<{ call: string; request: unknown }> = [];
  const ports: PlanFilePorts = {
    livePlan: async () => ({ meta: META, blocks: BLOCKS }),
    writer: {
      applyOps: async (request) => {
        writes.push({ call: "applyOps", request });
      },
      proposeChanges: async (request) => {
        writes.push({ call: "proposeChanges", request });

        return [];
      },
      failRefine: async (request) => {
        writes.push({ call: "failRefine", request });
      },
    },
  };

  return { writes, ports };
}

const edited = PLAN_MD.replace(
  "Checkout is slow.",
  "Checkout p95 is 450 ms; carts are abandoned at payment.",
).replace("Only the web checkout.", "Web and mobile checkout.");

describe("planMarkdown", () => {
  it("renders plan p1 as the plan.md its pod edits, one marked heading per section", async () => {
    const markdown = await planMarkdown("p1", recordingPorts().ports);

    expect({
      intent: markdown.includes("## What we want and why <!-- slot:intent -->"),
      prose: markdown.includes("Checkout is slow."),
    }).toEqual({ intent: true, prose: true });
  });
});

describe("applyPlanFile", () => {
  it("applies a draft's edited intent and scope as the planning agent's edits, one block each", async () => {
    const { writes, ports } = recordingPorts();

    await applyPlanFile(
      "p1",
      { actor: "planning-agent", markdown: edited, refine: null },
      ports,
    );

    expect(writes).toMatchObject([
      {
        call: "applyOps",
        request: {
          planId: "p1",
          actor: "planning-agent",
          ops: [
            {
              op: "replace-block",
              slot: "intent",
              block: {
                type: "paragraph",
                content: [
                  {
                    text: "Checkout p95 is 450 ms; carts are abandoned at payment.",
                  },
                ],
              },
            },
            {
              op: "replace-block",
              slot: "scope",
              block: {
                type: "paragraph",
                content: [{ text: "Web and mobile checkout." }],
              },
            },
          ],
        },
      },
    ]);
  });

  it("proposes no change for a Refine the agent answered by leaving its section as it was", async () => {
    const { writes, ports } = recordingPorts();

    await applyPlanFile(
      "p1",
      {
        actor: "planning-agent",
        markdown: PLAN_MD,
        refine: { slot: "intent", baseHash: "3f9a" },
      },
      ports,
    );

    expect(writes).toMatchObject([
      {
        call: "proposeChanges",
        request: { asked: { slot: "intent" }, ops: [] },
      },
    ]);
  });

  it("proposes each paragraph the pass changed as its own change, for a person to take where it lands", async () => {
    const { writes, ports } = recordingPorts();

    await applyPlanFile(
      "p1",
      {
        actor: "planning-agent",
        markdown: edited,
        refine: {
          slot: "intent",
          baseHash: "3f9a",
          uses: { questions: ["q1"] },
        },
      },
      ports,
    );

    expect(writes).toMatchObject([
      {
        call: "proposeChanges",
        request: {
          planId: "p1",
          asked: { slot: "intent", baseHash: "3f9a" },
          uses: { questions: ["q1"], comments: [] },
          ops: [
            { op: "replace-block", slot: "intent" },
            { op: "replace-block", slot: "scope" },
          ],
        },
      },
    ]);
  });

  it("refuses a plan.md whose only change it cannot read, writing nothing", async () => {
    const { writes, ports } = recordingPorts();
    const broken = `${PLAN_MD}\n## Rollout <!-- slot:custom-nowhere -->\n\nWaves.\n`;

    await expect(
      applyPlanFile(
        "p1",
        { actor: "planning-agent", markdown: broken, refine: null },
        ports,
      ),
    ).rejects.toMatchObject({ output: { statusCode: 400 } });
    expect(writes).toEqual([]);
  });
});
