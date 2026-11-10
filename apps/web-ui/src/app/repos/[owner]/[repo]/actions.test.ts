// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const createOnboardTask = vi.fn();
const ensureWebhook = vi.fn();
const redirect = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/onboard", () => ({
  createOnboardTask: (...a: unknown[]) => createOnboardTask(...a),
}));
vi.mock("@/lib/webhook-api", () => ({
  ensureWebhook: (...a: unknown[]) => ensureWebhook(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import { reonboard, setupWebhook } from "./actions";

beforeEach(() => {
  createOnboardTask.mockReset();
  ensureWebhook.mockReset();
  redirect.mockReset();
  revalidatePath.mockReset();
});

describe("reonboard", () => {
  it("creates an onboard task and redirects to the run of the new task", async () => {
    createOnboardTask.mockResolvedValue({ ok: true, taskId: "task-9" });

    await reonboard("re-cinq/x");

    expect(createOnboardTask).toHaveBeenCalledWith("re-cinq/x", {
      reonboard: true,
    });
    expect(redirect).toHaveBeenCalledWith("/assembly-runs/task-9");
  });

  it("redirects to the run of the in-flight task instead of queueing a duplicate", async () => {
    createOnboardTask.mockResolvedValue({
      ok: false,
      block: "in-flight",
      message: "already in flight",
      taskId: "task-running",
    });

    await reonboard("re-cinq/x");

    expect(redirect).toHaveBeenCalledWith("/assembly-runs/task-running");
  });

  it("returns the refusal error when no task is created", async () => {
    createOnboardTask.mockResolvedValue({
      ok: false,
      block: "pr-open",
      message: "PR open",
      taskId: null,
    });

    const result = await reonboard("re-cinq/x");

    expect(result).toEqual({ error: "PR open" });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("setupWebhook", () => {
  it("revalidates the repo page when webhook setup succeeds", async () => {
    ensureWebhook.mockResolvedValue({ state: "configured" });

    const result = await setupWebhook("re-cinq/x");

    expect(result).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/repos/re-cinq/x");
  });

  it("returns the refusal error without revalidating when webhook setup fails", async () => {
    ensureWebhook.mockResolvedValue({ error: "webhook setup failed (500)" });

    const result = await setupWebhook("re-cinq/x");

    expect(result).toEqual({ error: "webhook setup failed (500)" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
