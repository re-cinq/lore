import { describe, expect, it } from "vitest";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import type { LoopPause } from "@re-cinq/lore-shared/loops/loop-pause.js";
import type { ReportedVisit } from "@re-cinq/lore-shared/loops/credit-failure.js";
import { resumeLoop } from "./resume-loop.js";

const CREDIT = "Your credit balance is too low to access the Anthropic API.";

const creditPause = (runId: string | null): LoopPause => ({
  reason: "model credit exhausted",
  run_id: runId,
  at: "2026-10-31T09:00:00.000Z",
  until: null,
});

function scene(key: LoopKey, pause: LoopPause | null, visits: ReportedVisit[]) {
  const steps: string[] = [];

  const resume = () =>
    resumeLoop(key, pause, {
      resume: async () => {
        steps.push("resume");
      },
      visits: async (runId) => {
        steps.push(`visits ${runId}`);

        return visits;
      },
      rerun: async (runId, nodeId) => {
        steps.push(`rerun ${runId} ${nodeId}`);
      },
    });

  return { resume, steps };
}

describe("resumeLoop", () => {
  it("resumes the tickets loop and runs decompose of run-7 again", async () => {
    const { resume, steps } = scene("tickets", creditPause("run-7"), [
      { nodeId: "load-tickets", report: { outcome: "success" } },
      { nodeId: "decompose", report: { outcome: "failed", error: CREDIT } },
    ]);

    expect(await resume()).toBe("run-7");
    expect(steps).toEqual(["visits run-7", "rerun run-7 decompose", "resume"]);
  });

  it("resumes the implementation loop without running anything again, since its tick picks the ticket", async () => {
    const { resume, steps } = scene("implementation", creditPause("run-7"), [
      { nodeId: "tdd-round", report: { outcome: "failed", error: CREDIT } },
    ]);

    expect(await resume()).toBeNull();
    expect(steps).toEqual(["resume"]);
  });

  it("resumes the upkeep loop without running anything again when its run has no credit failure left", async () => {
    const { resume, steps } = scene("upkeep", creditPause("run-7"), [
      { nodeId: "update-specs", report: { outcome: "failed", error: CREDIT } },
      { nodeId: "update-specs", report: { outcome: "success" } },
    ]);

    expect(await resume()).toBeNull();
    expect(steps).toEqual(["visits run-7", "resume"]);
  });

  it("resumes the upkeep loop without running anything again when it was paused by no run", async () => {
    const { resume, steps } = scene("upkeep", creditPause(null), []);

    expect(await resume()).toBeNull();
    expect(steps).toEqual(["resume"]);
  });

  it("resumes the tickets loop that was not paused", async () => {
    const { resume, steps } = scene("tickets", null, []);

    expect(await resume()).toBeNull();
    expect(steps).toEqual(["resume"]);
  });

  it("resumes the digest loop without posting its starved day again beside the next one", async () => {
    const { resume, steps } = scene("digest", creditPause("run-7"), [
      { nodeId: "write", report: { outcome: "failed", error: CREDIT } },
    ]);

    expect(await resume()).toBeNull();
    expect(steps).toEqual(["resume"]);
  });

  it("keeps the tickets pause when the floor refuses to run decompose again", async () => {
    const steps: string[] = [];
    const resumed = resumeLoop("tickets", creditPause("run-7"), {
      resume: async () => {
        steps.push("resume");
      },
      visits: async () => [
        { nodeId: "decompose", report: { outcome: "failed", error: CREDIT } },
      ],
      rerun: async () => {
        throw new Error("409 the run is still open");
      },
    });

    await expect(resumed).rejects.toThrow(
      new Error("409 the run is still open"),
    );
    expect(steps).toEqual([]);
  });
});
