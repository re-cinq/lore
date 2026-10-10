// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RunBlobView, { type RunBlobViewProps } from "./RunBlobView";

const HASH = `sha256-${"ab12".repeat(16)}`;

const markdown: RunBlobViewProps["blob"] = {
  hash: HASH,
  contentType: "text/markdown",
  size: 24,
  text: "# Fix login (#412)\n\nBody.",
  truncated: false,
};

describe("RunBlobView", () => {
  it("renders a markdown blob as a heading and links back to the run", () => {
    render(<RunBlobView runId="run-1" blob={markdown} />);

    expect(
      screen.getByRole("heading", { name: "Fix login (#412)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "run-1" })).toHaveAttribute(
      "href",
      "/assembly-runs/run-1",
    );
  });

  it("shows the hash, content type and size of the blob", () => {
    render(<RunBlobView runId="run-1" blob={markdown} />);

    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(screen.getByText("text/markdown · 24 bytes")).toBeInTheDocument();
  });

  it("renders other text verbatim in a preformatted block", () => {
    const { container } = render(
      <RunBlobView
        runId="run-1"
        blob={{ ...markdown, contentType: "application/json", text: '{"a":1}' }}
      />,
    );

    expect(container.querySelector("pre")).toHaveTextContent('{"a":1}');
  });

  it("says a binary blob cannot be shown", () => {
    render(
      <RunBlobView
        runId="run-1"
        blob={{ ...markdown, contentType: "image/png", size: 4, text: null }}
      />,
    );

    expect(
      screen.getByText(
        "image/png, 4 bytes: not text, so there is nothing to show.",
      ),
    ).toBeInTheDocument();
  });

  it("says a cut blob was cut", () => {
    render(
      <RunBlobView runId="run-1" blob={{ ...markdown, truncated: true }} />,
    );

    expect(
      screen.getByText("Only the first 1 MiB is shown."),
    ).toBeInTheDocument();
  });
});
