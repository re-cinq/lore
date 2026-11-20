import { describe, it, expect } from "vitest";
import { closedIssue, mergedPr } from "../digest/fixtures.js";
import { releaseChanges } from "./release-changes.js";

const since = "2026-10-20T10:00:00Z";
const until = "2026-10-27T10:00:00Z";

describe("releaseChanges", () => {
  it("leaves out a PR merged exactly at the previous release and keeps one merged exactly at this one", () => {
    const changes = releaseChanges(
      {
        merged: [
          mergedPr({ number: 1, mergedAt: since }),
          mergedPr({ number: 2, mergedAt: until }),
        ],
        closed: [],
      },
      { since, until },
    );

    expect(changes.map((change) => change.number)).toEqual([2]);
  });

  it("lists everything merged and closed up to the release when there is no previous release", () => {
    const changes = releaseChanges(
      {
        merged: [mergedPr({ number: 1, mergedAt: "2020-01-01T00:00:00Z" })],
        closed: [closedIssue({ number: 12, closedAt: "2021-01-01T00:00:00Z" })],
      },
      { since: null, until },
    );

    expect(changes.map((change) => [change.kind, change.number])).toEqual([
      ["issue", 12],
      ["pr", 1],
    ]);
  });

  it("leaves out a PR merged after the release", () => {
    expect(
      releaseChanges(
        {
          merged: [mergedPr({ mergedAt: "2026-10-27T10:00:01Z" })],
          closed: [],
        },
        { since, until },
      ),
    ).toEqual([]);
  });

  it("lists issue 12 once, as the PR that closes it", () => {
    const changes = releaseChanges(
      {
        merged: [
          mergedPr({ body: "Fixes #12", mergedAt: "2026-10-22T10:00:00Z" }),
        ],
        closed: [closedIssue({ number: 12, closedAt: "2026-10-22T10:00:00Z" })],
      },
      { since, until },
    );

    expect(changes.map((change) => [change.kind, change.number])).toEqual([
      ["pr", 1],
    ]);
  });

  it("lists a merged PR under its author and a closed issue under its assignees, newest first", () => {
    expect(
      releaseChanges(
        {
          merged: [mergedPr({ number: 1, mergedAt: "2026-10-21T10:00:00Z" })],
          closed: [
            closedIssue({
              number: 12,
              assignees: ["carol"],
              closedAt: "2026-10-23T10:00:00Z",
            }),
          ],
        },
        { since, until },
      ),
    ).toEqual([
      {
        kind: "issue",
        number: 12,
        title: "An issue",
        url: "https://gh/i/12",
        people: ["carol"],
        at: "2026-10-23T10:00:00Z",
      },
      {
        kind: "pr",
        number: 1,
        title: "A change",
        url: "https://gh/pr/1",
        people: ["alice"],
        at: "2026-10-21T10:00:00Z",
      },
    ]);
  });
});
