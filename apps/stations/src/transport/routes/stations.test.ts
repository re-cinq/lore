import { describe, it, expect, beforeEach } from "vitest";
import Hapi from "@hapi/hapi";
import Boom from "@hapi/boom";
import { stationsRoute } from "./stations.js";
import type { StationRegistry } from "../../domain/station.js";

const TOKEN = "tok-1";
const auth = { authorization: `Bearer ${TOKEN}` };

let registry: StationRegistry;
let app: Hapi.Server;

function run(name: string): Promise<Hapi.ServerInjectResponse> {
  return app.inject({
    method: "POST",
    url: `/api/stations/${name}`,
    headers: auth,
  });
}

beforeEach(() => {
  registry = new Map([
    ["approval-check", async () => "Checked 3 tasks, 1 approved"],
  ]);
  app = Hapi.server({ port: 0 });
  app.route(stationsRoute({ registry: () => registry, bearerToken: TOKEN }));
});

describe("POST /api/stations/{name}", () => {
  it("runs the named station and returns the summary it reported", async () => {
    const res = await run("approval-check");

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ job: "approval-check", summary: "Checked 3 tasks, 1 approved" });
  });

  it("refuses a name no station answers to, rather than 500-ing on undefined", async () => {
    const res = await run("not-a-station");

    expect(res.statusCode).toBe(404);
    expect((res.result as { error: string }).error).toMatch(/not-a-station/);
  });

  it("refuses a caller with no bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/stations/approval-check",
    });

    expect(res.statusCode).toBe(401);
  });

  it("refuses a second concurrent run of the same station", async () => {
    let release: () => void = () => {};

    registry = new Map([
      [
        "slow",
        () =>
          new Promise<string>((resolve) => {
            release = () => resolve("done");
          }),
      ],
    ]);

    const inFlight = run("slow");
    const second = await run("slow");

    release();
    await inFlight;

    expect(second.statusCode).toBe(409);
    expect((second.result as { error: string }).error).toMatch(
      /already running/,
    );
  });

  it("frees the latch after a run so the next tick is not locked out forever", async () => {
    await run("approval-check");

    expect((await run("approval-check")).statusCode).toBe(200);
  });

  it("frees the latch after a FAILED run, so one error does not wedge the station", async () => {
    registry = new Map([
      [
        "boom",
        async () => {
          throw new Error("nope");
        },
      ],
    ]);

    expect((await run("boom")).statusCode).toBe(500);
    expect((await run("boom")).statusCode).toBe(500);
  });

  it("includes the station name as 'job' in the 200 body, so a courier or operator can confirm which station ran", async () => {
    const res = await run("approval-check");

    expect({ status: res.statusCode, body: res.result }).toMatchObject({
      status: 200,
      body: { job: "approval-check", summary: "Checked 3 tasks, 1 approved" },
    });
  });

  it("does not expose the job's failure reason in the response body — a Boom error from a station must not reach the courier", async () => {
    registry = new Map([
      [
        "db-job",
        async () => {
          throw new Boom.Boom(
            "postgresql://user:secret@db.internal:5432/lore",
            { statusCode: 503 },
          );
        },
      ],
    ]);

    const res = await run("db-job");

    expect({
      status: res.statusCode,
      bodyContainsSecret: JSON.stringify(res.result ?? {}).includes("secret"),
    }).toEqual({ status: 500, bodyContainsSecret: false });
  });
});
