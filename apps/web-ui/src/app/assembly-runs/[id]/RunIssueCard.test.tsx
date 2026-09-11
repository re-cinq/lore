// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RunIssueCard from "./RunIssueCard";
import type { Issue } from "@/lib/api/issues";

const issue: Issue = {
  number: 42,
  title: "Show the issue on the run page",
  state: "open",
  url: "https://github.com/re-cinq/lore/issues/42",
  body: [
    "## Why",
    "",
    "No `tab` switch.",
    "",
    "<!-- template hint -->",
    "<details><summary>More</summary>the detail</details>",
    "",
    "<script>alert(1)</script>",
  ].join("\n"),
};

describe("RunIssueCard", () => {
  it("titles the card with the issue number and title, pills its state and keeps it folded", () => {
    render(<RunIssueCard issue={{ ...issue, state: "closed" }} />);
    const title = screen.getByText(
      "Issue #42 · Show the issue on the run page",
    );

    expect({
      title: title.tagName,
      state: screen.getByText("closed").textContent,
      open: title.closest("details")?.hasAttribute("open"),
    }).toEqual({ title: "STRONG", state: "closed", open: false });
  });

  it("renders the body as GitHub-flavoured markdown, keeping details and dropping comments and scripts", () => {
    const { container } = render(<RunIssueCard issue={issue} />);

    expect({
      heading: container.querySelector("h2")?.textContent,
      code: container.querySelector("code")?.textContent,
      details: container.querySelector("details details summary")?.textContent,
      script: container.querySelector("script"),
      comment: container.textContent?.includes("template hint"),
    }).toEqual({
      heading: "Why",
      code: "tab",
      details: "More",
      script: null,
      comment: false,
    });
  });

  it("says the issue has no description when its body is empty", () => {
    render(<RunIssueCard issue={{ ...issue, body: null }} />);

    expect(screen.getByText("No description provided.")).toBeInTheDocument();
  });

  it("renders nothing for a run with no issue", () => {
    const { container } = render(<RunIssueCard issue={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
