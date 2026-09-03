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

  it("reports an overlapping tick as a skip, not a failure, so it doesn't burn the retry ladder into a dead letter", async () => {
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
