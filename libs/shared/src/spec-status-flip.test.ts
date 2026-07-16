import { describe, it, expect } from "vitest";
import { openSpecStatusFlipPr } from "./spec-status-flip.js";
import { parseDocStatus } from "./spec-status.js";
import type { Project } from "./index.js";

interface FakeState {
  branches: string[];
  commits: Array<{ branch: string; path: string; content: string }>;
  pulls: Array<{
    branch: string;
    title: string;
    body: string;
    labels: string[];
  }>;
}

function fakeProject(files: Record<string, string | null>): {
  project: Project;
  state: FakeState;
} {
  const state: FakeState = { branches: [], commits: [], pulls: [] };
  const project = {
    repo: {
      read: async (path: string) => files[path] ?? null,
      createBranch: async (branch: string) => {
        state.branches.push(branch);
      },
      commitFile: async (branch: string, path: string, content: string) => {
        state.commits.push({ branch, path, content });
      },
    },
    pulls: {
      open: async (
        branch: string,
        title: string,
        body: string,
        _base: string | undefined,
        labels: string[],
      ) => {
        state.pulls.push({ branch, title, body, labels });

        return { url: `https://example.test/pr/${state.pulls.length}` };
      },
    },
  } as unknown as Project;

  return { project, state };
}

const specWith = (status: string) =>
  [
    "# Spec",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Status | ${status} |`,
    "",
  ].join("\n");

describe("openSpecStatusFlipPr", () => {
  it("opens one PR that flips the status and carries the upkeep labels", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Draft"),
    });

    const result = await openSpecStatusFlipPr(
      project,
      "specs/example/spec.md",
      {
        evidence: "Completion: group g1 merged.",
      },
    );

    expect(result).toEqual({
      prUrl: "https://example.test/pr/1",
      skipped: false,
    });
    expect(state.branches).toHaveLength(1);
    expect(state.pulls).toHaveLength(1);
    expect(state.pulls[0].labels).toEqual([
      "lore-managed",
      "spec-status-upkeep",
    ]);
    expect(state.pulls[0].body).toContain("Completion: group g1 merged.");
    expect(parseDocStatus(state.commits[0].content, "spec").status).toBe(
      "shipped",
    );
  });

  it("skips without opening a PR when the spec is already Implemented", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Implemented"),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: null,
      skipped: true,
      reason: "already-current",
    });
    expect(state.branches).toHaveLength(0);
    expect(state.pulls).toHaveLength(0);
  });

  it("skips when the spec is missing on the default branch", async () => {
    const { project, state } = fakeProject({ "specs/example/spec.md": null });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({ prUrl: null, skipped: true, reason: "missing" });
    expect(state.pulls).toHaveLength(0);
  });

  it("reports no-status-row when the spec has no Status header", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": "# Spec\n\nNo status table here.\n",
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: null,
      skipped: true,
      reason: "no-status-row",
    });
    expect(state.pulls).toHaveLength(0);
  });
});
