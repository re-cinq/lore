import { describe, it, expect } from "vitest";
import { loreTaskRef, composeIssueBody } from "./issue-body.js";

describe("loreTaskRef", () => {
  it("links to the deployed task page when a UI url is set", () => {
    expect(loreTaskRef("abc-123", "https://lore.example.com")).toBe(
      "[abc-123](https://lore.example.com/pipeline/abc-123)",
    );
  });

  it("trims a trailing slash on the UI url", () => {
    expect(loreTaskRef("abc-123", "https://lore.example.com/")).toBe(
      "[abc-123](https://lore.example.com/pipeline/abc-123)",
    );
  });

  it("returns the bare uuid when no UI url is configured", () => {
    expect(loreTaskRef("abc-123", undefined)).toBe("abc-123");
  });
});

describe("composeIssueBody", () => {
  const driftTask = {
    id: "t1",
    created_by: "spec-drift",
    task_type: "gap-fill",
    context_bundle: { spec_path: "specs/x/spec.md" },
  };

  it("appends the guidance and a linkified footer for a drift task", () => {
    const body = composeIssueBody("LLM summary.", driftTask, "https://lore.example.com");
    expect(body).toMatch(/LLM summary\./);
    expect(body).toMatch(/What you should actually do/);
    expect(body).toMatch(/created by `spec-drift`/);
    expect(body).toMatch(/Lore-Task: \[t1\]\(https:\/\/lore\.example\.com\/pipeline\/t1\)/);
  });

  it("omits the guidance for a non-drift task but still writes the footer", () => {
    const body = composeIssueBody("Body.", { id: "t2", created_by: "ui", task_type: "implementation" }, undefined);
    expect(body).not.toMatch(/What you should actually do/);
    expect(body).toMatch(/Lore-Task: t2/);
  });

  it("lists graph-detected drifted statements verbatim when present", () => {
    const t = {
      ...driftTask,
      context_bundle: {
        spec_path: "specs/x/spec.md",
        drifted_statements: [{ text: "503 when DB down", reason: "violated", section: "Behavior" }],
      },
    };
    const body = composeIssueBody("Summary.", t, undefined);
    expect(body).toMatch(/503 when DB down/);
  });

  it("renders the validated-by link path for a graph-detected statement", () => {
    const t = {
      ...driftTask,
      context_bundle: {
        spec_path: "specs/x/spec.md",
        drifted_statements: [
          {
            text: "503 when DB down",
            reason: "violated",
            links: [{ label: "validated by health.test.ts", path: "src/health.test.ts", line: 42 }],
          },
        ],
      },
    };
    const body = composeIssueBody("Summary.", t, undefined);
    expect(body).toMatch(/src\/health\.test\.ts#L42/);
  });

  it("lists heuristic missing symbols when no graph statements rode in the bundle", () => {
    const t = {
      ...driftTask,
      context_bundle: {
        spec_path: "specs/x/spec.md",
        missing_symbols: [{ name: "resolveSettings", kind: "function", description: "settings resolver" }],
      },
    };
    const body = composeIssueBody("Summary.", t, undefined);
    expect(body).toMatch(/Missing symbols \(heuristic\)/);
    expect(body).toMatch(/`resolveSettings`/);
  });
});
