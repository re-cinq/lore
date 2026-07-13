import { describe, it, expect } from "vitest";
import { githubDedupeKey, k8sDedupeKey, cronDedupeKey } from "./dedupe.js";

describe("githubDedupeKey", () => {
  it("prefixes the X-GitHub-Delivery id", () => {
    expect(githubDedupeKey("a1b2-c3")).toBe("github:a1b2-c3");
  });
});

describe("k8sDedupeKey", () => {
  it("keys on task id and terminal phase so repeated MODIFIED events collapse", () => {
    expect(k8sDedupeKey("task-7", "Succeeded")).toBe("k8s:task-7:Succeeded");
  });
});

describe("cronDedupeKey", () => {
  it("floors the tick time to the minute so a restart replay collapses with the normal tick", () => {
    expect(
      cronDedupeKey("merge_check", new Date("2026-06-29T10:15:42.123Z")),
    ).toBe("cron:merge_check:2026-06-29T10:15Z");
  });

  it("produces distinct keys for different minutes", () => {
    const a = cronDedupeKey("reindex", new Date("2026-06-29T10:15:00Z"));
    const b = cronDedupeKey("reindex", new Date("2026-06-29T10:16:00Z"));

    expect(a).not.toBe(b);
  });
});
