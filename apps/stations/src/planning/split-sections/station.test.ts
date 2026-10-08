import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { splitSectionsHandle } from "./station.js";

const PLAN_URL = "https://lore.example/plans/p1";
const CITABLE = {
  plan_url: PLAN_URL,
  blocks: [
    {
      id: "b1",
      slot: "scope",
      kind: "paragraph",
      text: "Billing is out.",
      link: `${PLAN_URL}#b1`,
    },
    {
      id: "b2",
      slot: "risk",
      kind: "paragraph",
      text: "Rates may lag.",
      link: `${PLAN_URL}#b2`,
    },
  ],
};

function scene(doneSections?: string[]) {
  const produced: Record<string, string> = {};
  const files: Record<string, string> = {
    plan_blocks: JSON.stringify(CITABLE),
    ...(doneSections ? { done_sections: JSON.stringify(doneSections) } : {}),
  };
  const tools: Tools = {
    read: async (need) => Buffer.from(files[need] ?? ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };

  return { tools, produced };
}

const brief = {
  visitId: "visit-split",
  iteration: 1,
  needs: { plan_blocks: "blob://plan-blocks" },
};

describe("splitSectionsHandle", () => {
  it("reports more and hands over the scope section on the first visit", async () => {
    const { tools, produced } = scene();

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "more" },
      produced: {
        current_section: `## scope\n\n- Billing is out. ([plan](${PLAN_URL}#b1))\n`,
        done_sections: '["scope"]',
      },
    });
  });

  it("reports more with the risk section once scope is done", async () => {
    const { tools, produced } = scene(["scope"]);

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, done: produced.done_sections }).toEqual({
      report: { outcome: "more" },
      done: '["scope","risk"]',
    });
  });

  it("reports done and produces nothing once every section is done", async () => {
    const { tools, produced } = scene(["scope", "risk"]);

    const report = await splitSectionsHandle()(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "done" },
      produced: {},
    });
  });
});
