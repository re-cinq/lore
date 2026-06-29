import { describe, it, expect } from "vitest";
import { parseEventName, isValidEventName, SOURCES } from "./event-names.js";

describe("parseEventName", () => {
  it("splits github.pull_request.synchronize into source/subject/action", () => {
    expect(parseEventName("github.pull_request.synchronize")).toEqual({
      source: "github",
      subject: "pull_request",
      action: "synchronize",
    });
  });

  it("splits cron.agent_watcher_reconcile.tick", () => {
    expect(parseEventName("cron.agent_watcher_reconcile.tick")).toEqual({
      source: "cron",
      subject: "agent_watcher_reconcile",
      action: "tick",
    });
  });

  it("splits internal.ingest.spec_trace", () => {
    expect(parseEventName("internal.ingest.spec_trace")).toEqual({
      source: "internal",
      subject: "ingest",
      action: "spec_trace",
    });
  });

  it("throws when the source prefix is not a known source", () => {
    expect(() => parseEventName("slack.command.received")).toThrow(
      new Error("invalid event name (unknown source 'slack'): slack.command.received"),
    );
  });

  it("throws when there are fewer than three segments", () => {
    expect(() => parseEventName("github.push")).toThrow(
      new Error("invalid event name (need source.subject.action): github.push"),
    );
  });

  it("throws on an empty segment", () => {
    expect(() => parseEventName("github..synchronize")).toThrow(
      new Error("invalid event name (need source.subject.action): github..synchronize"),
    );
  });
});

describe("isValidEventName", () => {
  it("returns true for a well-formed github name", () => {
    expect(isValidEventName("github.check_suite.completed")).toBe(true);
  });

  it("returns false for an unknown source", () => {
    expect(isValidEventName("nope.x.y")).toBe(false);
  });

  it("returns false for two segments", () => {
    expect(isValidEventName("cron.tick")).toBe(false);
  });
});

describe("SOURCES", () => {
  it("contains exactly github, kubernetes, cron, internal", () => {
    expect([...SOURCES]).toEqual(["github", "kubernetes", "cron", "internal"]);
  });
});
