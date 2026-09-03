import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";
import { getNextTransition, type NodeVisit } from "./transition.js";
import type { StageOutcome } from "./node-types.js";

/**
 * Escalation is the channel a human hears about a failed task through, so its
 * steps must not be able to skip each other. Same rule as the merge line: every
 * step routes BOTH outcomes forward, because a failure to file the Issue is
 * exactly when the notification matters most.
 */
const escalation = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/escalation.yaml"),
    "utf8",
  ),
);

const successorsOf = (nodeId: string, on: string) =>
  escalation.edges
    .filter((e) => e.from === nodeId && e.on === on)
    .map((e) => e.to);

describe("the escalation line", () => {
  it("files the issue, then notifies", () => {
    expect(escalation.entry).toBe("file-issue");
    expect(successorsOf("file-issue", "success")).toEqual(["notify"]);
  });

  it("notifies even when filing the issue failed, which is when it matters most", () => {
    // This replaces escalation.ts's audit-only fallback: what was a catch block
    // is an edge, so the fallback is recorded as a visit rather than a log line.
    expect(successorsOf("file-issue", "failed")).toEqual(["notify"]);
  });

  it("gives every step its own job_ref, so the station knows which one it is", () => {
    const steps = escalation.nodes.filter((n) => n.type === "escalation_step");

    expect(steps.length).toBeGreaterThan(0);
    expect(steps.filter((n) => !n.job_ref)).toEqual([]);
  });

  it("reaches the exit whichever way each step goes", () => {
    const walkAnsweringEveryStep = (answer: StageOutcome): NodeVisit[] => {
      const visits: NodeVisit[] = [];

      for (let step = 0; step < 20; step++) {
        const t = getNextTransition(escalation, visits);

        if (t.kind === "finish" || t.kind === "fail") {
          break;
        }
        expect(t.kind).toBe("launch");

        if (t.kind === "launch") {
          visits.push({
            nodeId: t.nodeId,
            iteration: t.iteration,
            outcome: answer,
          });
        }
      }

      return visits;
    };

    for (const answer of ["success", "failed"] as StageOutcome[]) {
      const visits = walkAnsweringEveryStep(answer);

      expect(visits.map((v) => v.nodeId)).toEqual(["file-issue", "notify"]);
    }
  });
});
