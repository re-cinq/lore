import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import {
  maintenanceJobs,
  maintenanceRoute,
  type MaintenanceJobs,
} from "./maintenance.js";

async function serverWith(jobs: MaintenanceJobs): Promise<Hapi.Server> {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(maintenanceRoute(jobs));

  return server;
}

const POST = (job: string) => ({
  method: "POST" as const,
  url: `/api/maintenance/${job}`,
});

describe("POST /api/maintenance/{job}", () => {
  it("returns 200 and the job summary for a known job", async () => {
    const server = await serverWith({
      "memory-ttl": async () => "Cleaned up 3 expired memories",
    });
    const res = await server.inject(POST("memory-ttl"));

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 200,
      body: { job: "memory-ttl", summary: "Cleaned up 3 expired memories" },
    });
  });

  it("returns 404 for an unknown job", async () => {
    const server = await serverWith({ "memory-ttl": async () => "ok" });
    const res = await server.inject(POST("no-such-job"));

    expect(res.statusCode).toBe(404);
  });

  it("returns 500 when the job throws, without leaking the message", async () => {
    const server = await serverWith({
      "memory-ttl": async () => {
        throw new Error("connection to 10.0.0.4 refused");
      },
    });
    const res = await server.inject(POST("memory-ttl"));

    expect({
      status: res.statusCode,
      leaked: res.payload.includes("10.0.0.4"),
    }).toEqual({ status: 500, leaked: false });
  });

  it("runs only the job named in the path", async () => {
    const ran: string[] = [];
    const record = (name: string) => async () => {
      ran.push(name);

      return name;
    };
    const server = await serverWith({
      "memory-ttl": record("memory-ttl"),
      "importance-decay": record("importance-decay"),
    });

    await server.inject(POST("importance-decay"));

    expect(ran).toEqual(["importance-decay"]);
  });
});

describe("the maintenance jobs derive from the station registry", () => {
  it("answers for every cron-triggered station rather than a hand-written list", () => {
    const names = Object.keys(maintenanceJobs(() => null)).sort();

    expect(names).toEqual([
      "anthropic-cost-sync",
      "importance-decay",
      "memory-ttl",
    ]);
  });

  it("does not advertise a station it cannot run, so the failure is unreachable", () => {
    // approval-check declares a cron reconciler, but reaching a repo needs a
    // GitHub App lore-api does not have — so it is not exposed here at all.
    expect(Object.keys(maintenanceJobs(() => null))).not.toContain(
      "approval-check",
    );
  });
});
