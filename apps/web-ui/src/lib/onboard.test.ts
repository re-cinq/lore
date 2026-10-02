// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const onboardRepo = vi.fn();

vi.mock("./api/repos", () => ({ onboardRepo }));

const { createOnboardTask } = await import("./onboard");

beforeEach(() => {
  onboardRepo.mockReset();
});

describe("createOnboardTask", () => {
  it("returns the queued task id when the guard clears", async () => {
    onboardRepo.mockResolvedValue({
      status: "ok",
      data: {
        repo_id: "r1",
        task_id: "task-1",
        status: "onboarding-agent-spawned",
      },
    });

    expect(await createOnboardTask("re-cinq/lore")).toEqual({
      ok: true,
      taskId: "task-1",
    });
  });

  it("asks lore-api for the repo without a reonboard flag by default", async () => {
    onboardRepo.mockResolvedValue({ status: "ok", data: { task_id: "t" } });

    await createOnboardTask("re-cinq/lore");

    expect(onboardRepo).toHaveBeenCalledWith("re-cinq/lore", {});
  });

  it("passes the reonboard repair flag through", async () => {
    onboardRepo.mockResolvedValue({ status: "ok", data: { task_id: "t" } });

    await createOnboardTask("re-cinq/lore", { reonboard: true });

    expect(onboardRepo).toHaveBeenCalledWith("re-cinq/lore", {
      reonboard: true,
    });
  });

  it("surfaces the block and the blocking task from a refusal", async () => {
    onboardRepo.mockResolvedValue({
      status: "error",
      message: "an onboard task is already in flight",
      code: 409,
      body: {
        blocked: "in-flight",
        error: "an onboard task is already in flight",
        task_id: "task-7",
      },
    });

    expect(await createOnboardTask("re-cinq/lore")).toEqual({
      ok: false,
      block: "in-flight",
      message: "an onboard task is already in flight",
      taskId: "task-7",
    });
  });

  it("reports an already-onboarded refusal with no task to point at", async () => {
    onboardRepo.mockResolvedValue({
      status: "error",
      message: "repo is already onboarded",
      code: 409,
      body: { blocked: "already-onboarded", task_id: null },
    });

    expect(await createOnboardTask("re-cinq/lore")).toMatchObject({
      ok: false,
      block: "already-onboarded",
      taskId: null,
    });
  });

  it("reads a transport failure as in-flight so the submitter looks before resubmitting", async () => {
    onboardRepo.mockResolvedValue({ status: "error", message: "fetch failed" });

    expect(await createOnboardTask("re-cinq/lore")).toEqual({
      ok: false,
      block: "in-flight",
      message: "fetch failed",
      taskId: null,
    });
  });

  it("names the missing configuration when lore-api is unconfigured", async () => {
    onboardRepo.mockResolvedValue({ status: "unconfigured" });

    expect(await createOnboardTask("re-cinq/lore")).toMatchObject({
      ok: false,
      message:
        "Onboarding is unavailable: the web UI has no lore-api configured.",
    });
  });
});
