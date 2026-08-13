import { describe, it, expect } from "vitest";
import { specPhaseOf } from "./spec-phase";

describe("specPhaseOf", () => {
  const node = (
    nodeId: string,
    outcome: string | null,
    startedAt = "2026-08-12T19:00:00Z",
  ) => ({ nodeId, iteration: 1, outcome, startedAt }) as never;

  const run = (status: string, nodes: unknown[]) =>
    ({ status, nodes }) as never;

  it("reports the spec phase running, timed from the node that is working", () => {
    // The wizard used to decide this from a local boolean set when the button was
    // pressed, and time it from the last ROUND's creation — so a finished line left
    // "Writing the spec…" on screen forever, ticking past 80 minutes of a 15 minute
    // budget while nothing at all was running.
    expect(
      specPhaseOf(
        run("running", [
          node("author", "success"),
          node("analyse-specs", null, "2026-08-12T19:30:00Z"),
        ]),
      ),
    ).toEqual({ running: true, since: "2026-08-12T19:30:00Z" });
  });

  it("is not running once the line has finished", () => {
    // push succeeded and no PR appeared: the card must come down and give the author
    // their controls back, not imply work is still in flight.
    expect(
      specPhaseOf(run("finished", [node("push", "success")])),
    ).toMatchObject({ running: false });
  });

  it("is not running while a planning round is the open node", () => {
    expect(specPhaseOf(run("running", [node("analyze", null)]))).toMatchObject({
      running: false,
    });
  });

  it("is not running when there is no line at all", () => {
    expect(specPhaseOf(null)).toMatchObject({ running: false });
  });
});
