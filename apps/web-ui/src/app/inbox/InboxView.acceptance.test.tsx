// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { InboxEntry } from "@/lib/api/inbox";
import InboxView from "./InboxView";

const entry = (overrides: Partial<InboxEntry> = {}): InboxEntry => ({
  id: "run:1",
  kind: "failed_run",
  repo: "re-cinq/lore",
  title: "Build failed",
  detail: "OOM in dod pod",
  waiting_since: "2026-10-10T10:00:00Z",
  open_url: "/assembly-runs/1",
  actions: [],
  state: {},
  ...overrides,
});

describe("InboxView", () => {
  it("renders list ordered by wait time", () => {
    const newer = entry({
      id: "pr:2",
      kind: "spec_pr",
      repo: "re-cinq/floor",
      title: "Newer spec PR",
      detail: "Draft spec ready for review",
      waiting_since: "2026-10-12T10:00:00Z",
    });
    const older = entry({
      id: "run:1",
      kind: "failed_run",
      repo: "re-cinq/lore",
      title: "Older failed run",
      detail: "Step test failed with exit 1",
      waiting_since: "2026-10-10T08:00:00Z",
    });

    render(
      <InboxView
        entries={[newer, older]}
        counts={{ failed_run: 1, spec_pr: 1 }}
      />,
    );

    const rows = within(
      screen.getByRole("list", { name: "Inbox items" }),
    ).getAllByRole("listitem");
    const detail = screen.getByRole("complementary", {
      name: "Selected item detail",
    });

    expect({
      first: rows[0].textContent,
      second: rows[1].textContent,
      initialDetail: detail.textContent,
    }).toEqual({
      first: expect.stringContaining("Older failed run"),
      second: expect.stringContaining("Newer spec PR"),
      initialDetail: expect.stringContaining("Step test failed with exit 1"),
    });

    fireEvent.click(
      within(rows[1]).getByRole("button", { name: /Newer spec PR/ }),
    );

    expect(detail).toHaveTextContent("Draft spec ready for review");
  });

  it("filters items by kind chip", () => {
    const failedRun = entry({
      id: "run:1",
      kind: "failed_run",
      title: "Build failed",
    });
    const specPr = entry({
      id: "pr:2",
      kind: "spec_pr",
      title: "Spec PR waiting",
    });

    render(
      <InboxView
        entries={[failedRun, specPr]}
        counts={{ failed_run: 2, spec_pr: 1 }}
      />,
    );

    const chip = screen.getByRole("button", { name: /Failed run\s*2/i });

    fireEvent.click(chip);

    const list = screen.getByRole("list", { name: "Inbox items" });

    expect(within(list).getByText("Build failed")).toBeInTheDocument();
    expect(within(list).queryByText("Spec PR waiting")).toBeNull();

    fireEvent.click(chip);

    expect(within(list).getByText("Spec PR waiting")).toBeInTheDocument();
  });

  it("states nothing is waiting when empty", () => {
    render(<InboxView entries={[]} counts={{}} />);

    expect(screen.getByText(/nothing is waiting/i)).toBeInTheDocument();
  });

  it("names unavailable sources on the page", () => {
    render(
      <InboxView entries={[]} counts={{}} unavailable={["floor", "github"]} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Unavailable sources: floor, github",
    );
  });
});
