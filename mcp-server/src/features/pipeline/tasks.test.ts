import { describe, it, expect } from "vitest";
import { parseTasks, inferPhaseDependencies } from "@re-cinq/lore-shared";

describe("parseTasks", () => {
  it("parses basic tasks", () => {
    const md = `- [ ] T001 Do something\n- [x] T002 Done thing`;
    const tasks = parseTasks(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      specTaskId: "T001",
      description: "Do something",
      completed: false,
      parallelizable: false,
      phase: 0,
    });
    expect(tasks[1]).toMatchObject({
      specTaskId: "T002",
      completed: true,
    });
  });

  it("parses [P] marker", () => {
    const md = `- [ ] T001 [P] Parallel task`;
    const tasks = parseTasks(md);
    expect(tasks[0].parallelizable).toBe(true);
    expect(tasks[0].description).toBe("Parallel task");
  });

  it("parses [DEPENDS ON:] markers", () => {
    const md = `- [ ] T003 Build thing [DEPENDS ON: T001, T002]`;
    const tasks = parseTasks(md);
    expect(tasks[0].dependsOn).toEqual(["T001", "T002"]);
    expect(tasks[0].description).toBe("Build thing");
  });

  it("extracts file path from | suffix", () => {
    const md = `- [ ] T001 Create service | worker/src/services/zoho.ts`;
    const tasks = parseTasks(md);
    expect(tasks[0].filePath).toBe("worker/src/services/zoho.ts");
    expect(tasks[0].description).toBe("Create service");
  });

  it("extracts backtick-wrapped file path", () => {
    const md = "- [ ] T001 Create service | `worker/src/services/zoho.ts`";
    const tasks = parseTasks(md);
    expect(tasks[0].filePath).toBe("worker/src/services/zoho.ts");
  });

  it("extracts phase numbers from headers", () => {
    const md = [
      "## Phase 1: Setup",
      "- [ ] T001 Do setup",
      "- [ ] T002 More setup",
      "## Phase 2: Build",
      "- [ ] T003 Build thing",
      "## Phase 3: Polish",
      "- [ ] T004 Polish thing",
    ].join("\n");
    const tasks = parseTasks(md);
    expect(tasks).toHaveLength(4);
    expect(tasks[0].phase).toBe(1);
    expect(tasks[1].phase).toBe(1);
    expect(tasks[2].phase).toBe(2);
    expect(tasks[3].phase).toBe(3);
  });

  it("ignores non-task lines", () => {
    const md = [
      "# Task Breakdown",
      "",
      "Some description text",
      "",
      "## Phase 1",
      "",
      "### Backend",
      "",
      "- [ ] T001 Real task",
      "- Not a task",
      "- [ ] T002 Another task",
    ].join("\n");
    const tasks = parseTasks(md);
    expect(tasks).toHaveLength(2);
  });

  it("handles combined markers", () => {
    const md = `- [ ] T005 [P] Do parallel work [DEPENDS ON: T001] | src/file.ts`;
    const tasks = parseTasks(md);
    expect(tasks[0]).toMatchObject({
      specTaskId: "T005",
      parallelizable: true,
      dependsOn: ["T001"],
      filePath: "src/file.ts",
    });
  });
});

describe("inferPhaseDependencies", () => {
  it("returns tasks unchanged when no phases", () => {
    const tasks = parseTasks([
      "- [ ] T001 First",
      "- [ ] T002 Second",
    ].join("\n"));
    const result = inferPhaseDependencies(tasks);
    expect(result[0].dependsOn).toEqual([]);
    expect(result[1].dependsOn).toEqual([]);
  });

  it("makes Phase 2 tasks depend on all Phase 1 tasks", () => {
    const tasks = parseTasks([
      "## Phase 1",
      "- [ ] T001 Setup A",
      "- [ ] T002 Setup B",
      "## Phase 2",
      "- [ ] T003 Build",
    ].join("\n"));
    const result = inferPhaseDependencies(tasks);
    expect(result[0].dependsOn).toEqual([]); // Phase 1 first task, no deps
    expect(result[2].dependsOn).toContain("T001");
    expect(result[2].dependsOn).toContain("T002");
  });

  it("chains sequential tasks within a phase", () => {
    const tasks = parseTasks([
      "## Phase 1",
      "- [ ] T001 First",
      "- [ ] T002 Second",
      "- [ ] T003 Third",
    ].join("\n"));
    const result = inferPhaseDependencies(tasks);
    expect(result[0].dependsOn).toEqual([]);
    expect(result[1].dependsOn).toContain("T001");
    expect(result[2].dependsOn).toContain("T002");
  });

  it("parallel [P] tasks have no intra-phase deps", () => {
    const tasks = parseTasks([
      "## Phase 1",
      "- [ ] T001 [P] Parallel A",
      "- [ ] T002 [P] Parallel B",
      "- [ ] T003 Sequential after parallels",
    ].join("\n"));
    const result = inferPhaseDependencies(tasks);
    expect(result[0].dependsOn).toEqual([]); // [P] no deps
    expect(result[1].dependsOn).toEqual([]); // [P] no deps
    // T003 is sequential but there's no previous sequential task, so no intra-phase dep
    expect(result[2].dependsOn).toEqual([]);
  });

  it("preserves explicit [DEPENDS ON:] markers", () => {
    const tasks = parseTasks([
      "## Phase 1",
      "- [ ] T001 Setup",
      "## Phase 2",
      "- [ ] T002 Build [DEPENDS ON: T001]",
    ].join("\n"));
    const result = inferPhaseDependencies(tasks);
    // T002 has explicit dep, should NOT be overwritten
    expect(result[1].dependsOn).toEqual(["T001"]);
  });

  it("handles three phases correctly", () => {
    const tasks = parseTasks([
      "## Phase 1",
      "- [ ] T001 [P] Setup A",
      "- [ ] T002 [P] Setup B",
      "## Phase 2",
      "- [ ] T003 [P] Build A",
      "- [ ] T004 Build B",
      "## Phase 3",
      "- [ ] T005 Deploy",
    ].join("\n"));
    const result = inferPhaseDependencies(tasks);

    // Phase 1: no deps
    expect(result[0].dependsOn).toEqual([]);
    expect(result[1].dependsOn).toEqual([]);

    // Phase 2: depend on Phase 1
    expect(result[2].dependsOn).toContain("T001");
    expect(result[2].dependsOn).toContain("T002");
    // T004 (sequential) also depends on Phase 1 + previous sequential in phase
    expect(result[3].dependsOn).toContain("T001");
    expect(result[3].dependsOn).toContain("T002");

    // Phase 3: depends on Phase 2
    expect(result[4].dependsOn).toContain("T003");
    expect(result[4].dependsOn).toContain("T004");
  });

  it("returns empty array for empty input", () => {
    expect(inferPhaseDependencies([])).toEqual([]);
  });
});
