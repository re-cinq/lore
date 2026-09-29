import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAssemblyLine } from "./loader.js";
import { getNextTransition, type NodeVisit } from "./transition.js";

const issueTriage = parseAssemblyLine(
  readFileSync(
    join(import.meta.dirname, "assembly-lines/issue-triage.yaml"),
    "utf8",
  ),
);

describe("the issue triage line", () => {
  it("specs/issue-triage/spec.md#User Story 5 - Human-Gated Handoff to Implementation (Priority: P1)", () => {
    // A diagnosed issue stops processing and waits for a human to apply the lore:implementation label.
    // Successfully verified issues park at the human-gate node.

    // Simulate walking the graph
    const visits: NodeVisit[] = [];

    // 1. reproduce -> success -> diagnose
    let t = getNextTransition(issueTriage, visits);
    expect(t).toEqual({ kind: "launch", nodeId: "reproduce", iteration: 1 });
    visits.push({ nodeId: "reproduce", outcome: "success", iteration: 1 });

    // 2. diagnose -> success -> verify
    t = getNextTransition(issueTriage, visits);
    expect(t).toEqual({ kind: "launch", nodeId: "diagnose", iteration: 1 });
    visits.push({ nodeId: "diagnose", outcome: "success", iteration: 1 });

    // 3. verify -> success -> human-gate
    t = getNextTransition(issueTriage, visits);
    expect(t).toEqual({ kind: "launch", nodeId: "verify", iteration: 1 });
    visits.push({ nodeId: "verify", outcome: "success", iteration: 1 });

    // 4. human-gate (parks because human station wait)
    t = getNextTransition(issueTriage, visits);
    expect(t).toEqual({ kind: "launch", nodeId: "human-gate", iteration: 1 });

    // When a human station is launched, the next thing the engine does is wait
    // for a human outcome (a null outcome in the visits means it's parked).
    // Let's simulate that the node is running but no outcome yet (await).
    visits.push({ nodeId: "human-gate", outcome: null, iteration: 1 });
    t = getNextTransition(issueTriage, visits);
    expect(t).toEqual({ kind: "await" });

    // Once human gives success, it should finish
    visits.pop();
    visits.push({ nodeId: "human-gate", outcome: "success", iteration: 1 });
    t = getNextTransition(issueTriage, visits);
    expect(t).toEqual({ kind: "finish" });
  });
});
