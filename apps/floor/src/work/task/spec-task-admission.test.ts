import { describe, it, expect } from "vitest";
import { admitSpecTasks } from "./spec-task-admission.js";
import type { ReadySpecTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";

const GROUP = "18773dbb";
const YAML = "libs/assembly-lines/src/assembly-lines/issue-triage.yaml";

function ready(
  id: string,
  bundle: { file_path?: string; parallelizable?: boolean },
): ReadySpecTask {
  return {
    id,
    description: id,
    target_repo: "re-cinq/lore",
    task_group_id: GROUP,
    context_bundle: { spec_task_id: id, ...bundle },
  } as ReadySpecTask;
}

const ids = (tasks: ReadySpecTask[]) => tasks.map((task) => task.id);

describe("admitSpecTasks", () => {
  it("admits one of T003 and T004 when both edit issue-triage.yaml, the first in order", () => {
    expect(
      ids(
        admitSpecTasks(
          [
            ready("T003", { file_path: YAML, parallelizable: true }),
            ready("T004", { file_path: YAML, parallelizable: true }),
          ],
          [],
        ),
      ),
    ).toEqual(["T003"]);
  });

  it("holds T004 back while T003, running in its group, edits the same file", () => {
    expect(
      admitSpecTasks(
        [ready("T004", { file_path: YAML, parallelizable: true })],
        [{ task_group_id: GROUP, file_path: YAML, parallelizable: true }],
      ),
    ).toEqual([]);
  });

  it("runs T002 and T010 side by side when both are parallelizable and touch different files", () => {
    expect(
      ids(
        admitSpecTasks(
          [
            ready("T002", {
              file_path: "apps/floor/x.ts",
              parallelizable: true,
            }),
            ready("T010", { file_path: "README.md", parallelizable: true }),
          ],
          [],
        ),
      ),
    ).toEqual(["T002", "T010"]);
  });

  it("runs a task that is not parallelizable alone in its group", () => {
    expect(
      ids(
        admitSpecTasks(
          [
            ready("T002", {
              file_path: "apps/floor/x.ts",
              parallelizable: false,
            }),
            ready("T010", { file_path: "README.md", parallelizable: true }),
          ],
          [],
        ),
      ),
    ).toEqual(["T002"]);
  });

  it("holds every task of a group back while a non-parallelizable sibling runs", () => {
    expect(
      admitSpecTasks(
        [ready("T010", { file_path: "README.md", parallelizable: true })],
        [
          {
            task_group_id: GROUP,
            file_path: "apps/floor/x.ts",
            parallelizable: false,
          },
        ],
      ),
    ).toEqual([]);
  });

  it("caps a group at 3 running tasks", () => {
    const running = ["a", "b", "c"].map((file) => ({
      task_group_id: GROUP,
      file_path: file,
      parallelizable: true,
    }));

    expect(
      admitSpecTasks(
        [ready("T009", { file_path: "d", parallelizable: true })],
        running,
      ),
    ).toEqual([]);
  });

  it("leaves another group's running work out of the decision", () => {
    expect(
      ids(
        admitSpecTasks(
          [ready("T004", { file_path: YAML, parallelizable: false })],
          [{ task_group_id: "other", file_path: YAML, parallelizable: false }],
        ),
      ),
    ).toEqual(["T004"]);
  });
});
