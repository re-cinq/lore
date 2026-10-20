// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { InboxItem } from "@/lib/api/inbox";
import InboxView, { parseInboxFilter } from "./InboxView";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

const entry = (over: Partial<InboxItem>): InboxItem => ({
  kind: "failed",
  runId: "run-1",
  repo: "re-cinq/lore",
  title: "implementation-loop failed",
  body: "CI never went green",
  since: "2026-10-20T10:00:00.000Z",
  link: null,
  ...over,
});

const ENTRIES = [
  entry({}),
  entry({ kind: "waiting", runId: "run-2", title: "code-review is waiting" }),
];

const chip = (name: RegExp) => screen.getByRole("link", { name });

describe("InboxView", () => {
  it("links each kind chip to its filter with the count it would show", () => {
    render(<InboxView entries={ENTRIES} filter="all" nowMs={NOW} />);

    expect(chip(/^All/)).toHaveTextContent("All 2");
    expect(chip(/^Waiting/)).toHaveAttribute("href", "/inbox?kind=waiting");
  });

  it("keeps only the chosen kind under its chip", () => {
    render(<InboxView entries={ENTRIES} filter="waiting" nowMs={NOW} />);

    expect(screen.getAllByTestId("inbox-item")).toHaveLength(1);
    expect(screen.getByText("code-review is waiting")).toBeInTheDocument();
  });

  it("says nothing is waiting when the inbox is empty", () => {
    render(<InboxView entries={[]} filter="all" nowMs={NOW} />);

    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
  });

  it("moves the selection with j and opens the selected run with e", () => {
    render(<InboxView entries={ENTRIES} filter="all" nowMs={NOW} />);
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "e" });

    expect(screen.getAllByTestId("inbox-item")[1]).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(push).toHaveBeenCalledWith("/assembly-runs/run-2");
  });

  it("offers the run and its pull request as the card's actions", () => {
    const linked = entry({
      link: { label: "Open pull request", href: "https://pr" },
    });

    render(<InboxView entries={[linked]} filter="all" nowMs={NOW} />);

    expect(screen.getByRole("link", { name: "Open run" })).toHaveAttribute(
      "href",
      "/assembly-runs/run-1",
    );
    expect(
      screen.getByRole("link", { name: "Open pull request" }),
    ).toHaveAttribute("href", "https://pr");
  });
});

describe("parseInboxFilter", () => {
  it("reads a known kind and falls back to all for anything else", () => {
    expect(parseInboxFilter("failed")).toBe("failed");
    expect(parseInboxFilter(["waiting"])).toBe("waiting");
    expect(parseInboxFilter("bogus")).toBe("all");
  });
});
