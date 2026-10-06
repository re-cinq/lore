import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import { StationClient } from "@re-cinq/lore-shared/project/stations/station-client.js";
import { stationsRoute } from "./stations.js";
import type { StationRegistry } from "../../domain/station.js";

const TOKEN = "tok-1";

let registry: StationRegistry;
let client: StationClient;
let injectAsFetch: typeof fetch;

beforeEach(() => {
  registry = new Map([
    ["memory-ttl", async () => "Cleaned up 3 expired memories"],
  ]);

  const app = Hapi.server({ port: 0 });

  app.route(stationsRoute({ registry: () => registry, bearerToken: TOKEN }));

  injectAsFetch = (async (url: string, init: RequestInit) => {
    const res = await app.inject({
      method: (init.method ?? "GET") as "POST",
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
    });

    return new Response(res.payload, { status: res.statusCode });
  }) as unknown as typeof fetch;

  client = new StationClient("http://stations.test", TOKEN, injectAsFetch);
});

describe("StationClient against the real stations route (contract drift caught here, not on a cron tick)", () => {
  it("returns the summary the station reported, for the job_runs row", async () => {
    expect(await client.run("memory-ttl")).toBe(
      "Cleaned up 3 expired memories",
    );
  });

  it("throws on an unknown station rather than reporting an empty success", async () => {
    await expect(client.run("not-a-station")).rejects.toThrow(
      /station "not-a-station" failed: 404/,
    );
  });

  it("throws when the token is wrong, so a refused sweep is not logged as a run", async () => {
    const wrongToken = new StationClient(
      "http://stations.test",
      "not-the-token",
      injectAsFetch,
    );

    await expect(wrongToken.run("memory-ttl")).rejects.toThrow(/401/);
  });

  it("escapes a name with a slash rather than reaching a different path", async () => {
    await expect(client.run("../healthz")).rejects.toThrow(/failed: 404/);
  });
});
