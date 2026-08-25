import { describe, it, expect } from "vitest";
import { StationClient } from "./station-client.js";

function client(status: number, body: unknown = {}) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  return new StationClient("http://stations", "t", fetchImpl);
}

describe("StationClient.run", () => {
  it("returns the station's summary on success", async () => {
    expect(
      await client(200, { summary: "3 repos swept" }).run("merge-check"),
    ).toBe("3 repos swept");
  });

  it("reports an overlapping tick as a skip, not a failure", async () => {
    // The station latches while it runs and answers 409 to a tick that arrives
    // before the last one finished. That is the sweep saying "already on it" —
    // the work is not lost, the next tick picks it up. Raised as an error it
    // burns the retry ladder and dead-letters once a minute forever.
    expect(await client(409).run("merge-check")).toBe(
      "skipped: already running",
    );
  });

  it("still throws on a real failure, so a broken station is not silently green", async () => {
    await expect(client(500).run("merge-check")).rejects.toThrow(
      /station "merge-check" failed: 500/,
    );
  });

  it("still throws when no station answers to the name", async () => {
    await expect(client(404).run("nope")).rejects.toThrow(
      /station "nope" failed: 404/,
    );
  });
});
