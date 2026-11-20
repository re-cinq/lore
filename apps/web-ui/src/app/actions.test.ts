// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const createOnboardTask = vi.fn();

vi.mock("@/lib/onboard", () => ({
  createOnboardTask: (...a: unknown[]) => createOnboardTask(...a),
}));

import { updateSetup } from "./actions";

beforeEach(() => {
  createOnboardTask.mockReset();
});

describe("updateSetup", () => {
  it("posts a re-onboard per repo and reports started with the task id", async () => {
    createOnboardTask
      .mockResolvedValueOnce({ ok: true, taskId: "t1" })
      .mockResolvedValueOnce({ ok: true, taskId: "t2" });

    const result = await updateSetup(["re-cinq/a", "re-cinq/b"]);

    expect(createOnboardTask).toHaveBeenCalledWith("re-cinq/a", {
      reonboard: true,
    });
    expect(createOnboardTask).toHaveBeenCalledWith("re-cinq/b", {
      reonboard: true,
    });
    expect(result).toEqual([
      { repo: "re-cinq/a", status: "started", taskId: "t1" },
      { repo: "re-cinq/b", status: "started", taskId: "t2" },
    ]);
  });

  it("reports a repo with a task in flight as running and a refused one with its reason", async () => {
    createOnboardTask
      .mockResolvedValueOnce({
        ok: false,
        block: "in-flight",
        message: "busy",
        taskId: "t9",
      })
      .mockResolvedValueOnce({
        ok: false,
        block: "in-flight",
        message: "not onboarded",
        taskId: null,
      });

    expect(await updateSetup(["re-cinq/a", "re-cinq/b"])).toEqual([
      { repo: "re-cinq/a", status: "running", taskId: "t9" },
      { repo: "re-cinq/b", status: "refused", reason: "not onboarded" },
    ]);
  });

  it("reports a thrown error as that repo's refusal and still settles the others", async () => {
    createOnboardTask
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, taskId: "t2" });

    expect(await updateSetup(["re-cinq/a", "re-cinq/b"])).toEqual([
      { repo: "re-cinq/a", status: "refused", reason: "boom" },
      { repo: "re-cinq/b", status: "started", taskId: "t2" },
    ]);
  });
});
