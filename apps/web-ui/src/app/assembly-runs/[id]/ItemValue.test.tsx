// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ItemValue from "./ItemValue";

const HASH = `sha256-${"ab12".repeat(16)}`;
const preview = (over: Record<string, unknown> = {}) => ({
  hash: HASH,
  contentType: "text/markdown",
  size: 20,
  text: "# Fix login\n\nThe form posts twice.\n",
  truncated: false,
  ...over,
});

describe("ItemValue", () => {
  it("cuts a 300 character value to 200 characters and an ellipsis, whole on hover", () => {
    const value = "x".repeat(300);

    render(<ItemValue runId="run-1" value={value} />);

    const shown = screen.getByTitle(value);

    expect(shown).toHaveTextContent(`${"x".repeat(200)}…`);
  });

  it("leaves a short value whole and untitled", () => {
    render(<ItemValue runId="run-1" value="task-1" />);

    expect(screen.getByText("task-1")).not.toHaveAttribute("title");
  });

  it("links a pull request URL, whatever its length", () => {
    const url = `https://github.com/re-cinq/lore/pull/412?${"q".repeat(300)}`;

    render(<ItemValue runId="run-1" value={url} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", url);
  });

  it("shows a short markdown file in place, its heading Fix login", () => {
    render(<ItemValue runId="run-1" value={HASH} preview={preview()} />);

    expect(
      screen.getByRole("heading", { name: "Fix login" }),
    ).toBeInTheDocument();
  });

  it("links a file whose preview was cut to its blob page instead of showing it", () => {
    render(
      <ItemValue
        runId="run-1"
        value={HASH}
        preview={preview({ truncated: true })}
      />,
    );

    expect({
      href: screen.getByRole("link").getAttribute("href"),
      heading: screen.queryByRole("heading"),
    }).toEqual({ href: `/assembly-runs/run-1/blobs/${HASH}`, heading: null });
  });

  it("shows sections, JSON inside JSON, as slot and text with ## repair on its own line", () => {
    const sections = JSON.stringify([
      JSON.stringify({ slot: "*", text: "## repair\n\nFix it.\n" }),
    ]);

    render(<ItemValue runId="run-1" value={sections} />);

    expect({
      slot: screen.getByText("slot") !== null,
      text: screen.getByText(/## repair/).textContent,
    }).toEqual({ slot: true, text: "## repair\n\nFix it.\n" });
  });

  it("copies the raw ref task-1 when its copy button is pressed", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.assign(navigator, { clipboard: { writeText } });
    render(<ItemValue runId="run-1" value="task-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("task-1");
  });
});
