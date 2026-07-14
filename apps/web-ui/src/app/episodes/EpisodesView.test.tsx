// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import EpisodesView, { type EpisodeRow } from "./EpisodesView";

const SOURCES = ["manual", "session", "pr-review", "ci"];

const row = (over: Partial<EpisodeRow>): EpisodeRow => ({
  id: "ep-1",
  agent_id: "abcdef0123456789",
  source: "manual",
  ref: "pr-42",
  content_preview: "A short preview",
  fact_count: 3,
  created_at: "2026-06-03T10:00:00Z",
  ...over,
});

describe("EpisodesView", () => {
  it("renders a row per episode with truncated agent id, source badge, ref and fact count", () => {
    render(
      <EpisodesView
        offset={0}
        totalCount={2}
        sources={SOURCES}
        pageSize={30}
        episodes={[
          row({
            id: "ep-1",
            agent_id: "abcdef0123456789",
            source: "manual",
            ref: "pr-42",
            fact_count: 3,
          }),
          row({
            id: "ep-2",
            agent_id: "99887766aabbccdd",
            source: "session",
            ref: "sess-7",
            fact_count: 9,
            content_preview: "Another preview",
          }),
        ]}
      />,
    );

    const table = within(screen.getByRole("table"));

    expect(table.getByText("abcdef01…")).toBeInTheDocument();
    expect(table.getByText("99887766…")).toBeInTheDocument();
    expect(table.getByText("Manual")).toHaveClass("op-badge", "op-manual");
    expect(table.getByText("Session")).toHaveClass("op-badge", "op-session");
    expect(table.getByText("pr-42")).toBeInTheDocument();
    expect(table.getByText("sess-7")).toBeInTheDocument();
    expect(table.getByText("3")).toBeInTheDocument();
    expect(table.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("2 episodes")).toBeInTheDocument();
  });

  it("renders an em dash when ref is null", () => {
    render(
      <EpisodesView
        offset={0}
        totalCount={1}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({ ref: null })]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("appends an ellipsis when the content preview is at the 300-char cap", () => {
    const capped = "x".repeat(300);

    render(
      <EpisodesView
        offset={0}
        totalCount={1}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({ content_preview: capped })]}
      />,
    );
    expect(screen.getByText(`${capped}...`)).toBeInTheDocument();
  });

  it("does not append an ellipsis when the content preview is below the cap", () => {
    render(
      <EpisodesView
        offset={0}
        totalCount={1}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({ content_preview: "short body" })]}
      />,
    );
    expect(screen.getByText("short body")).toBeInTheDocument();
    expect(screen.queryByText("short body...")).not.toBeInTheDocument();
  });

  it("renders the source filter options", () => {
    render(
      <EpisodesView
        source="session"
        offset={0}
        totalCount={1}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({})]}
      />,
    );
    expect(
      screen.getByRole("option", { name: "All sources" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "PR review" }),
    ).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toEqual(
      "session",
    );
  });

  it("shows the empty-state row when there are no episodes", () => {
    render(
      <EpisodesView
        offset={0}
        totalCount={0}
        sources={SOURCES}
        pageSize={30}
        episodes={[]}
      />,
    );
    expect(screen.getByText(/No episodes yet/)).toBeInTheDocument();
    expect(screen.getByText("write_episode")).toBeInTheDocument();
  });

  it("hides pagination when the total fits on one page", () => {
    render(
      <EpisodesView
        offset={0}
        totalCount={30}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({})]}
      />,
    );
    expect(screen.queryByText("← Previous")).not.toBeInTheDocument();
    expect(screen.queryByText("Next →")).not.toBeInTheDocument();
  });

  it("disables Previous and links Next on the first page with source carried into the url", () => {
    render(
      <EpisodesView
        source="manual"
        offset={0}
        totalCount={90}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({})]}
      />,
    );
    const prev = screen.getByText("← Previous");
    const next = screen.getByText("Next →");

    expect(prev).toHaveClass("disabled");
    expect(prev).toHaveAttribute("href", "/episodes?source=manual");
    expect(next).not.toHaveClass("disabled");
    expect(next).toHaveAttribute("href", "/episodes?source=manual&offset=30");
    expect(screen.getByText("1–30 of 90")).toBeInTheDocument();
  });

  it("disables Next and links Previous on the last page", () => {
    render(
      <EpisodesView
        offset={60}
        totalCount={90}
        sources={SOURCES}
        pageSize={30}
        episodes={[row({})]}
      />,
    );
    const prev = screen.getByText("← Previous");
    const next = screen.getByText("Next →");

    expect(next).toHaveClass("disabled");
    expect(prev).not.toHaveClass("disabled");
    expect(prev).toHaveAttribute("href", "/episodes?offset=30");
    expect(screen.getByText("61–90 of 90")).toBeInTheDocument();
  });
});
