// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queueTask = vi.fn();
const getSession = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/api/tasks", () => ({
  createTask: (...a: unknown[]) => queueTask(...a),
}));
vi.mock("@/lib/session", () => ({
  getSession: (...a: unknown[]) => getSession(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));

import { createTask } from "./create-task-action";

function formData(fields: Record<string, string>): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  return form;
}

beforeEach(() => {
  queueTask.mockReset();
  getSession.mockReset();
  revalidatePath.mockReset();
  redirect.mockReset();
  getSession.mockResolvedValue(null);
});

describe("createTask", () => {
  it("returns without queuing when description is blank", async () => {
    await createTask(formData({ description: "   " }));

    expect(queueTask).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("queues a task with defaults when only description is given", async () => {
    queueTask.mockResolvedValue({ status: "ok", data: { task_id: "t-1" } });

    await createTask(formData({ description: "fix the thing" }));

    expect(queueTask).toHaveBeenCalledWith({
      description: "fix the thing",
      taskType: "general",
      targetRepo: "re-cinq/lore",
      priority: "normal",
      createdBy: "ui",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/assembly-runs");
    expect(redirect).toHaveBeenCalledWith("/tasks/t-1");
  });

  it("normalizes any non-immediate priority value to normal", async () => {
    queueTask.mockResolvedValue({ status: "ok", data: { task_id: "t-2" } });

    await createTask(
      formData({ description: "fix the thing", priority: "urgent" }),
    );

    expect(queueTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "normal" }),
    );
  });

  it("passes immediate priority through unchanged", async () => {
    queueTask.mockResolvedValue({ status: "ok", data: { task_id: "t-3" } });

    await createTask(
      formData({ description: "fix the thing", priority: "immediate" }),
    );

    expect(queueTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "immediate" }),
    );
  });

  it("attributes the task to the session user's name over email", async () => {
    queueTask.mockResolvedValue({ status: "ok", data: { task_id: "t-4" } });
    getSession.mockResolvedValue({
      user: { name: "Ford Prefect", email: "ford@example.com" },
    });

    await createTask(formData({ description: "fix the thing" }));

    expect(queueTask).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "Ford Prefect" }),
    );
  });

  it("falls back to the session email when no name is set", async () => {
    queueTask.mockResolvedValue({ status: "ok", data: { task_id: "t-5" } });
    getSession.mockResolvedValue({ user: { email: "ford@example.com" } });

    await createTask(formData({ description: "fix the thing" }));

    expect(queueTask).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "ford@example.com" }),
    );
  });

  it("does not redirect when the queue call fails", async () => {
    queueTask.mockResolvedValue({ status: "error", error: "boom" });

    await createTask(formData({ description: "fix the thing" }));

    expect(redirect).not.toHaveBeenCalled();
  });
});
