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
        {
          title,
          body,
          labels,
        }: { title: string; body: string; labels?: string[] },
      ) => {
        state.pulls.push({ branch, title, body, labels: labels ?? [] });

        return { url: `https://example.test/pr/${state.pulls.length}` };
      },
    },
  } as unknown as Project;

  return { project, state };
}

const LINK = "([validated by](payments.test.ts#L10))";

const specWith = (status: string, linked: 0 | 1 | 2) =>
  [
    "# Spec",
    "",
    "Intro paragraph describing the feature.",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Status | ${status} |`,
    "",
    "## Functional Requirements",
    "",
    `The system returns a receipt for every payment.${linked >= 1 ? ` ${LINK}` : ""}`,
    "",
    `The system emails the receipt to the payer.${linked >= 2 ? ` ${LINK}` : ""}`,
  ].join("\n");

describe("openSpecStatusFlipPr", () => {
  it("opens one PR marking a fully-linked Draft spec Shipped, with the upkeep labels", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Draft", 2),
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
      status: "shipped",
    });
    expect(state.branches).toHaveLength(1);
    expect(state.pulls).toHaveLength(1);
    expect(state.pulls[0].labels).toEqual([
      "lore-managed",
      "spec-status-upkeep",
    ]);
    expect(state.pulls[0].title).toBe("Mark specs/example/spec.md Shipped");
    expect(state.pulls[0].body).toContain("Completion: group g1 merged.");
    expect(state.pulls[0].body).toContain("2 of 2");
    expect(parseDocStatus(state.commits[0].content, "spec").status).toBe(
      "shipped",
    );
  });

  it("marks a partially-linked Draft spec In Progress, not Shipped", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Draft", 1),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: "https://example.test/pr/1",
      skipped: false,
      status: "in-progress",
    });
    expect(state.pulls[0].title).toBe("Mark specs/example/spec.md In Progress");
    expect(state.pulls[0].body).toContain("1 of 2");
    expect(parseDocStatus(state.commits[0].content, "spec").status).toBe(
      "in-progress",
    );
  });

  it("demotes a Shipped spec to In Progress when a statement has lost its link", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Shipped", 1),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: "https://example.test/pr/1",
      skipped: false,
      status: "in-progress",
    });
    expect(parseDocStatus(state.commits[0].content, "spec").status).toBe(
      "in-progress",
    );
  });

  it("skips without opening a PR when the status already matches coverage", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Implemented", 2),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: null,
      skipped: true,
      reason: "already-current",
      status: "shipped",
    });
    expect(state.branches).toHaveLength(0);
    expect(state.pulls).toHaveLength(0);
  });

  it("skips an unlinked Draft spec, whose Draft status already matches", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Draft", 0),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: null,
      skipped: true,
      reason: "already-current",
      status: "draft",
    });
    expect(state.pulls).toHaveLength(0);
  });

  it("skips a Retired spec so a terminal status is never reopened", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Retired", 1),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: null,
      skipped: true,
      reason: "terminal",
      status: "retired",
    });
    expect(state.pulls).toHaveLength(0);
  });

  it("skips a Rejected spec so a terminal status is never reopened", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": specWith("Rejected", 1),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toMatchObject({ skipped: true, reason: "terminal" });
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

  it("reports no-coverage-tier when the spec has no testable statements", async () => {
    const { project, state } = fakeProject({
      "specs/example/spec.md": [
        "# Spec",
        "",
        "Intro paragraph describing the feature.",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Status | Draft |",
        "",
        "## Rationale",
        "",
        "We chose receipts because auditors require them.",
      ].join("\n"),
    });

    const result = await openSpecStatusFlipPr(project, "specs/example/spec.md");

    expect(result).toEqual({
      prUrl: null,
      skipped: true,
      reason: "no-coverage-tier",
      status: "draft",
    });
    expect(state.pulls).toHaveLength(0);
  });
});
