import { describe, expect, it } from "vitest";
import { packSyncAnswerLine } from "./pack-sync-answer.js";

describe("packSyncAnswerLine", () => {
  it("names the commit and the agents a 200 applied", () => {
    expect(
      packSyncAnswerLine({
        status: 200,
        body: '{"status":"applied","commit":"a1b2c3d","changed":["triager","reviewer"]}',
      }),
    ).toBe("pack a1b2c3d applied: triager, reviewer");
  });

  it("says another replica holds the lease when lore-api skipped the sync", () => {
    expect(
      packSyncAnswerLine({ status: 200, body: '{"skipped":"lease held"}' }),
    ).toBe("pack sync skipped: another replica holds the lease");
  });

  it("reads a refusal as its status and body", () => {
    expect(
      packSyncAnswerLine({ status: 403, body: '{"error":"forbidden"}' }),
    ).toBe('HTTP 403 {"error":"forbidden"}');
  });

  it("reads a dropped socket as its message", () => {
    expect(packSyncAnswerLine({ status: 0, body: "socket hang up" })).toBe(
      "socket hang up",
    );
  });

  it("reads a 200 that is no sync result as unreadable", () => {
    expect(packSyncAnswerLine({ status: 200, body: "<html>" })).toBe(
      "200 with an unreadable answer: <html>",
    );
  });
});
