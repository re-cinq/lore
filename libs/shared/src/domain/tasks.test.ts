import { describe, it, expect } from "vitest";
import {
  parseTasks,
  inferPhaseDependencies,
  specSlugFromBranch,
} from "./tasks.js";

describe("specSlugFromBranch", () => {
  it("extracts the slug from a feature-request branch, dropping the 8-hex task suffix", () => {
    expect(
      specSlugFromBranch("lore/feature-request/dark-factory-a1b2c3d4"),
    ).toBe("dark-factory");
  });

  it("returns null for a non-feature-request branch", () => {
    expect(specSlugFromBranch("lore/implementation/foo-a1b2c3d4")).toBeNull();
  });

  it("returns null when the branch has a prefix but no slug", () => {
    expect(specSlugFromBranch("lore/feature-request/-a1b2c3d4")).toBeNull();
  });
});

describe("parseTasks", () => {
  it("parses an open task line into id, description, and phase 0 defaults", () => {
    expect(parseTasks("- [ ] T001 Build the thing")).toEqual([
      {
        specTaskId: "T001",
        description: "Build the thing",
        dependsOn: [],
        parallelizable: false,
        completed: false,
        phase: 0,
        filePath: undefined,
      },
    ]);
  });

  it("marks a checked box as completed", () => {
    expect(parseTasks("- [x] T002 Ship it")[0]).toMatchObject({
      specTaskId: "T002",
      completed: true,
    });
  });

  it("reads the [P] marker as parallelizable and strips it from the description", () => {
    expect(parseTasks("- [ ] T003 [P] Run in parallel")[0]).toMatchObject({
      description: "Run in parallel",
      parallelizable: true,
    });
  });

  it("extracts a backtick-quoted file path from the | suffix", () => {
    expect(parseTasks("- [ ] T004 Edit it | `src/a.ts`")[0]).toMatchObject({
      description: "Edit it",
      filePath: "src/a.ts",
    });
  });

  it("splits a [DEPENDS ON: ...] marker into a dependsOn list", () => {
    expect(
      parseTasks("- [ ] T005 Wire it [DEPENDS ON: T001, T002]")[0],
    ).toMatchObject({
      description: "Wire it",
      dependsOn: ["T001", "T002"],
    });
  });

  it("parses a line combining checkbox, [P], deps, and file path", () => {
    const [task] = parseTasks(
      "- [x] T006 [P] Do all [DEPENDS ON: T001] | src/b.ts",
    );

    expect(task).toEqual({
      specTaskId: "T006",
      description: "Do all",
      dependsOn: ["T001"],
      parallelizable: true,
      completed: true,
      phase: 0,
      filePath: "src/b.ts",
    });
  });

  it("assigns each task the phase number from the preceding ## Phase header", () => {
    const markdown = [
      "## Phase 1",
      "- [ ] T001 First",
      "## Phase 2",
      "- [ ] T002 Second",
    ].join("\n");

    const tasks = parseTasks(markdown);

    expect(tasks.map((t) => [t.specTaskId, t.phase])).toEqual([
      ["T001", 1],
      ["T002", 2],
    ]);
  });

  it("ignores lines that are not task or phase lines", () => {
    const markdown =
      "# Title\n\nSome prose.\n- [ ] T001 Real task\n- not a task";

    expect(parseTasks(markdown)).toHaveLength(1);
  });
});

describe("inferPhaseDependencies", () => {
  it("returns an empty list unchanged", () => {
    expect(inferPhaseDependencies([])).toEqual([]);
  });

  it("leaves phase-0-only tasks untouched", () => {
    const tasks = parseTasks("- [ ] T001 A\n- [ ] T002 B");

    expect(inferPhaseDependencies(tasks)).toBe(tasks);
  });

  it("makes a later-phase task depend on every task of the previous phase", () => {
    const tasks = parseTasks(
      [
        "## Phase 1",
        "- [ ] T001 A",
        "- [ ] T002 B",
        "## Phase 2",
        "- [ ] T003 C",
      ].join("\n"),
    );

    const t003 = inferPhaseDependencies(tasks).find(
      (t) => t.specTaskId === "T003",
    );

    expect(t003?.dependsOn).toEqual(["T001", "T002"]);
  });

  it("chains sequential (non-[P]) tasks within a phase", () => {
    const tasks = parseTasks(
      ["## Phase 1", "- [ ] T001 A", "- [ ] T002 B"].join("\n"),
    );

    const t002 = inferPhaseDependencies(tasks).find(
      (t) => t.specTaskId === "T002",
    );

    expect(t002?.dependsOn).toEqual(["T001"]);
  });

  it("leaves [P] tasks within a phase free of intra-phase dependencies", () => {
    const tasks = parseTasks(
      ["## Phase 1", "- [ ] T001 [P] A", "- [ ] T002 [P] B"].join("\n"),
    );

    const result = inferPhaseDependencies(tasks);

    expect(result.map((t) => t.dependsOn)).toEqual([[], []]);
  });

  it("preserves explicit dependencies instead of overwriting them with inferred ones", () => {
    const tasks = parseTasks(
      [
        "## Phase 1",
        "- [ ] T001 A",
        "## Phase 2",
        "- [ ] T002 B [DEPENDS ON: T009]",
      ].join("\n"),
    );

    const t002 = inferPhaseDependencies(tasks).find(
      (t) => t.specTaskId === "T002",
    );

    expect(t002?.dependsOn).toEqual(["T009"]);
  });
});
