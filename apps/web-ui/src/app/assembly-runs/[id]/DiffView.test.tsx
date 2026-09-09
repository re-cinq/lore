// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DiffView from "./DiffView";
import { diffViewModel } from "@/lib/pull-file-diff";
import type { PullFileChange } from "@/lib/api/pull-files";

const change = (patch: string | null): PullFileChange => ({
  filename: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch,
});

describe("DiffView", () => {
  it("says Not changed in this PR. for an absent model", () => {
    render(<DiffView model={{ kind: "absent" }} />);

    expect(screen.getByText("Not changed in this PR.")).toBeInTheDocument();
  });

  it("says No text diff for this file. for a binary model", () => {
    render(<DiffView model={diffViewModel(change(null))} />);

    expect(screen.getByText("No text diff for this file.")).toBeInTheDocument();
  });

  it("heads the diff with filename, +added −removed and status", () => {
    render(
      <DiffView
        model={diffViewModel(change("@@ -1,2 +1,2 @@\n-old\n+new\n ctx"))}
      />,
    );

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getByText("modified")).toBeInTheDocument();
  });

  it("renders each line with its kind, old and new numbers and a prefix", () => {
    const { container } = render(
      <DiffView
        model={diffViewModel(change("@@ -1,2 +1,2 @@\n-old\n+new\n ctx"))}
      />,
    );

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-diff-line]"),
    ).map((row) => ({
      kind: row.getAttribute("data-diff-line"),
      text: row.textContent,
    }));

    expect(rows).toEqual([
      { kind: "hunk", text: " @@ -1,2 +1,2 @@" },
      { kind: "del", text: "1-old" },
      { kind: "add", text: "1+new" },
      { kind: "ctx", text: "22 ctx" },
    ]);
  });
});
