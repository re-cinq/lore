import { describe, it, expect } from "vitest";
import { stationSubscriptions, STATIONS_SUBSCRIBER } from "./subscriptions.js";
import { STATIONS } from "../work/registry.js";
import { buildStationHandlers } from "./handlers.js";

describe("what the stations service subscribes to", () => {
  it("claims every event name a station's manifest declares", () => {
    const declared = Object.values(STATIONS).flatMap((mod) =>
      mod.manifest.triggers
        .filter((t) => t.kind === "event")
        .flatMap((t) => t.eventNames),
    );

    for (const name of declared) {
      expect(stationSubscriptions().map((s) => s.eventName)).toContain(name);
    }
  });

  it("subscribes each name once, so one delivery is not asked for twice", () => {
    const names = stationSubscriptions().map((s) => s.eventName);

    expect(names.length).toBe(new Set(names).size);
  });

  it("names one subscriber for the whole service, since two replicas share a backlog", () => {
    expect(STATIONS_SUBSCRIBER).toBe("stations");
  });
});

describe("every subscription has something to handle it", () => {
  it("maps a handler for each name it subscribes to, so nothing dead-letters on arrival", () => {
    const handlers = buildStationHandlers();
    const unhandled = stationSubscriptions()
      .map((s) => s.eventName)
      .filter((name) => !handlers.has(name));

    expect(unhandled).toEqual([]);
  });

  it("handles no name it did not subscribe to, which it would never receive", () => {
    const subscribed = new Set(stationSubscriptions().map((s) => s.eventName));
    const orphans = [...buildStationHandlers().keys()].filter(
      (name) => !subscribed.has(name),
    );

    expect(orphans).toEqual([]);
  });
});

describe("the review events, which only a deployment with a floor asks for", () => {
  it("claims github.pull_request.opened when FLOOR_API_URL and FLOOR_SERVICE_TOKEN are set", () => {
    const names = stationSubscriptions({
      FLOOR_API_URL: "http://floor-api:8080",
      FLOOR_SERVICE_TOKEN: "secret",
    }).map((s) => s.eventName);

    expect(names).toContain("github.pull_request.opened");
  });

  it("claims only the pull-request events the blocked-reason station reads, the close among them for its overlay drop, and no comment event when no floor is configured", () => {
    const names = stationSubscriptions({}).map((s) => s.eventName);

    expect(
      names
        .filter((name) => /^github\.(pull_request|issue_comment\.)/.test(name))
        .sort(),
    ).toEqual([
      "github.pull_request.closed",
      "github.pull_request.opened",
      "github.pull_request.ready_for_review",
      "github.pull_request.reopened",
      "github.pull_request.synchronize",
      "github.pull_request_review.submitted",
    ]);
  });

  it("claims github.push whether or not a floor is configured, so a merge to main reaches the Utopia commit mirror", () => {
    expect(stationSubscriptions({}).map((s) => s.eventName)).toContain(
      "github.push",
    );
  });

  it("claims github.tracker.changed whether or not a floor is configured, so an edited issue or pull request reaches the Utopia tracker mirror", () => {
    expect(stationSubscriptions({}).map((s) => s.eventName)).toContain(
      "github.tracker.changed",
    );
  });

  it("claims github.release.changed whether or not a floor is configured, so a published release reaches the Utopia release mirror", () => {
    expect(stationSubscriptions({}).map((s) => s.eventName)).toContain(
      "github.release.changed",
    );
  });

  it("claims the label and rename events whether or not a floor is configured", () => {
    const names = stationSubscriptions({}).map((s) => s.eventName);

    expect(
      names.filter((name) =>
        ["github.issues.labeled", "github.repository.renamed"].includes(name),
      ),
    ).toEqual(["github.issues.labeled", "github.repository.renamed"]);
  });
});

describe("the sweeps that run on a tick", () => {
  it("claims the merge-check and pr-ready-check ticks, so no other service has to start those sweeps", () => {
    const names = stationSubscriptions({}).map((s) => s.eventName);

    expect(
      ["cron.merge_check.tick", "cron.pr_ready_check.tick"].filter(
        (tick) => !names.includes(tick),
      ),
    ).toEqual([]);
  });

  it("claims cron.utopia_backfill.tick with a 43200-second visibility budget, so the reaper leaves a night of one-repo-at-a-time backfills running", () => {
    expect(
      stationSubscriptions({}).find(
        (s) => s.eventName === "cron.utopia_backfill.tick",
      ),
    ).toEqual({
      eventName: "cron.utopia_backfill.tick",
      visibilityTimeoutSeconds: 43_200,
    });
  });
});
