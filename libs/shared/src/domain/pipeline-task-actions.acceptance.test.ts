import { describe, it, expect, vi } from "vitest";
import { retryTask } from "./pipeline-task-actions.js";
import type { PgPool } from "./memory-store-types.js";

describe("retryTask", () => {
  it("refuses to retry an implementation-loop task and points at removing lore:blocked", async () => {
    const query = vi.fn((sql: string, _params?: unknown[]) =>
      Promise.resolve({
        rows: sql.includes("FROM pipeline.tasks")
          ? [
              {
                id: "task-1",
                status: "failed",
                description: "build it",
                task_type: "implementation-loop",
                target_repo: "re-cinq/lore",
                created_by: "loop",
              },
            ]
          : [],
      }),
    );

    await expect(
      retryTask({ query } as unknown as PgPool, "task-1"),
    ).rejects.toThrow(/remove the lore:blocked label/);
  });
});
