// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";

vi.mock("../LoopRunsFollower", () => ({ default: () => null }));

import type { RepoLoop } from "@/lib/api/loops";
import StreamingBoard, { type StreamedRead } from "./StreamingBoard";
import { sectionLimitsOf, pagingOf } from "./section-limits";

const loop = (key: RepoLoop["key"], label: string): RepoLoop => ({
  key,
  label,
  description: "",
  enabled: true,
});

const REVIEW = loop("review", "Code review");
const MERGE = loop("merge", "Auto merge");

const empty = {
  current: [],
  backlog: [],
  parked: [],
  awaiting_merge: [],
  recent: [],
};

const readWithCurrent = (of: RepoLoop, title: string): StreamedRead => ({
  loop: of,
  sections: {
    ...empty,
    current: [
      {
        loop: of,
        ref: "#7",
        title,
        url: null,
        state: "running",
        since: null,
        runId: null,
        pipeline: null,
        prUrl: null,
        tag: null,
        hold: null,
      },
    ],
  },
});

function deferred() {
  let settle: (read: StreamedRead) => void = () => undefined;
  const promise = new Promise<StreamedRead>((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

function board(reads: Promise<StreamedRead>[]) {
  return (
    <StreamingBoard
      loops={[REVIEW, MERGE]}
      reads={reads}
      paging={pagingOf("/repos/acme/widgets/loops", {})}
      subject="Work"
      retry={async () => undefined}
    />
  );
}

describe("StreamingBoard", () => {
  it("draws Code review's row as soon as it arrives, names Auto merge as loading, and drops the name when its rows land", async () => {
    const review = deferred();
    const merge = deferred();

    render(board([review.promise, merge.promise]));
    await act(async () => review.settle(readWithCurrent(REVIEW, "Review me")));

    const whileLoading = {
      row: shows("Review me"),
      loading: within(screen.getByTestId("loops-loading")).getByText(
        "Auto merge",
      ).textContent,
    };

    await act(async () => merge.settle(readWithCurrent(MERGE, "Merge me")));

    expect({
      whileLoading,
      after: {
        rows: ["Review me", "Merge me"].map(shows),
        loading: screen.queryByTestId("loops-loading"),
      },
    }).toEqual({
      whileLoading: { row: true, loading: "Auto merge" },
      after: { rows: [true, true], loading: null },
    });
  });

  it("says the empty sections are loading Code review and Auto merge before either answers", () => {
    render(board([deferred().promise, deferred().promise]));

    expect(
      screen.getAllByText("Loading Code review and Auto merge…").length,
    ).toBeGreaterThan(0);
  });

  it("keeps Code review's row through a refresh and names it as loading until its new read lands", async () => {
    const first = deferred();
    const merge = Promise.resolve(readWithCurrent(MERGE, "Merge me"));
    const { rerender } = render(board([first.promise, merge]));

    await act(async () => first.settle(readWithCurrent(REVIEW, "Review me")));
    const again = deferred();

    rerender(board([again.promise, merge]));

    expect({
      row: shows("Review me"),
      loading: within(screen.getByTestId("loops-loading")).queryByText(
        "Code review",
      )?.textContent,
      limits: sectionLimitsOf({}).recent,
    }).toEqual({ row: true, loading: "Code review", limits: 5 });
  });
});

function shows(title: string): boolean {
  return screen
    .queryAllByTestId("board-row")
    .some((row) => row.textContent.includes(title));
}
