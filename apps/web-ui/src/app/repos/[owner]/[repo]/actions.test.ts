// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const createOnboardTask = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/onboard", () => ({
  createOnboardTask: (...a: unknown[]) => createOnboardTask(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));

import { reonboard } from "./actions";

beforeEach(() => {
  createOnboardTask.mockReset();
  redirect.mockReset();
});

describe("reonboard", () => {
  it("creates an onboard task and redirects to the new task page", async () => {
    createOnboardTask.mockResolvedValue({ ok: true, taskId: "task-9" });

    await reonboard("re-cinq/x");

    expect(createOnboardTask).toHaveBeenCalledWith("re-cinq/x", {
      reonboard: true,
    });
    expect(redirect).toHaveBeenCalledWith("/tasks/task-9");
  });

  it("redirects to the in-flight task instead of queueing a duplicate", async () => {
    createOnboardTask.mockResolvedValue({
      ok: false,
      block: "in-flight",
      message: "already in flight",
      taskId: "task-running",
    });

    await reonboard("re-cinq/x");

    expect(redirect).toHaveBeenCalledWith("/tasks/task-running");
  });

  it("redirects back to the repo page when no task is created", async () => {
    createOnboardTask.mockResolvedValue({
      ok: false,
      block: "pr-open",
      message: "PR open",
      taskId: null,
    });

    await reonboard("re-cinq/x");

    expect(redirect).toHaveBeenCalledWith("/repos/re-cinq/x");
  });
});
