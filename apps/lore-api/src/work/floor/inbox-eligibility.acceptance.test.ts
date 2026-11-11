import { describe, expect, it } from "vitest";
import type { LineSource } from "./floor-line-facts.js";
import { readLineFacts } from "./floor-line-facts.js";

const LINE_BODY = {
  entry: "start",
  exit: "done",
  fail: "gave-up",
  args: {},
  nodes: [
    { id: "start" },
    { id: "await-ci", station: "loop-await-ci" },
    { id: "pr-review", station: "loop-pr-review" },
    { id: "analyze", station: "plan-analyze" },
    { id: "done" },
  ],
  edges: [],
};

const STATIONS: Record<string, any> = {
  "loop-await-ci": {
    id: "loop-await-ci",
    body: { kind: "human", produces: ["ci_feedback_sha"] },
  },
  "loop-pr-review": {
    id: "loop-pr-review",
    body: { kind: "human", produces: ["review_feedback_sha"] },
  },
  "plan-analyze": {
    id: "plan-analyze",
    body: { kind: "agent" },
  },
};

const floor: LineSource = {
  lines: { version: async () => ({ body: LINE_BODY }) } as any,
  stations: { get: async (name: string) => STATIONS[name] } as any,
};

describe("Inbox eligibility", () => {
  it.extend({ spec: "specs/inbox/spec.md#FR2.7" })(
    "reads the station kind from the station body the line version names",
    async () => {
      const run = { lineId: "line-1", lineHash: "hash-1" } as any;
      const facts = await readLineFacts(floor, run);

      expect((facts as any).stations["loop-await-ci"].kind).toBe("human");
      expect((facts as any).stations["plan-analyze"].kind).toBe("agent");
    },
  );

  it.extend({ spec: "specs/inbox/spec.md#FR2.6" })(
    "excludes await-ci from actionable human waiting items",
    async () => {
      const run = { lineId: "line-1", lineHash: "hash-1" } as any;
      const facts = await readLineFacts(floor, run);

      expect((facts as any).isWaitingOnPerson?.("await-ci")).toBe(false);
      expect((facts as any).isWaitingOnPerson?.("pr-review")).toBe(true);
      expect((facts as any).isWaitingOnPerson?.("analyze")).toBe(false);
    },
  );
});
