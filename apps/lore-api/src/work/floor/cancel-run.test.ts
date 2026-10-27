import { describe, expect, it, vi } from "vitest";
import type { CancelRunFloor } from "./cancel-run.js";
import { cancelRun } from "./cancel-run.js";

function floor({
  found = true,
  finishedAt = null,
}: { found?: boolean; finishedAt?: string | null } = {}) {
  return {
    runs: {
      get: vi
        .fn()
        .mockResolvedValue(
          found ? { run: { id: "plan-run", finishedAt }, bag: {} } : null,
        ),
      cancel: vi.fn().mockResolvedValue({ id: "plan-run" }),
    },
  } as unknown as CancelRunFloor;
}

describe("cancelRun", () => {
  it("cancels open plan-run with a reason naming gedaiu and answers its id", async () => {
    const source = floor();

    await expect(
      cancelRun(source, { runId: "plan-run", requestedBy: "gedaiu" }),
    ).resolves.toEqual({ runId: "plan-run" });
    expect(source.runs.cancel).toHaveBeenCalledWith(
      "plan-run",
      "cancelled from the run page by gedaiu",
    );
  });

  it("cancels with the run page reason alone when nobody is named", async () => {
    const source = floor();

    await cancelRun(source, { runId: "plan-run" });

    expect(source.runs.cancel).toHaveBeenCalledWith(
      "plan-run",
      "cancelled from the run page",
    );
  });

  it("refuses run plan-run, which the floor does not have, with 404 and cancels nothing", async () => {
    const source = floor({ found: false });

    await expect(
      cancelRun(source, { runId: "plan-run" }),
    ).rejects.toMatchObject({
      message: "the floor has no run plan-run",
      output: { statusCode: 404 },
    });
    expect(source.runs.cancel).not.toHaveBeenCalled();
  });

  it("refuses a run that finished at 2026-10-07T09:00:00Z with 409 and cancels nothing", async () => {
    const source = floor({ finishedAt: "2026-10-07T09:00:00Z" });

    await expect(
      cancelRun(source, { runId: "plan-run" }),
    ).rejects.toMatchObject({
      message: "run plan-run already finished",
      output: { statusCode: 409 },
    });
    expect(source.runs.cancel).not.toHaveBeenCalled();
  });
});
