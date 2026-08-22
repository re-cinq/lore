import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import Hapi from "@hapi/hapi";
import type { EventInsert } from "@re-cinq/lore-shared";
import { eventsRoute } from "./events.js";

const SECRET = "shhh";
const TOKEN = "tok-1";

let inserted: EventInsert[];

function server(): Hapi.Server {
  const s = Hapi.server({ port: 0 });

  s.route(
    eventsRoute({
      insert: async (ev) => {
        inserted.push(ev);
      },
      webhookSecret: SECRET,
      bearerToken: TOKEN,
    }),
  );

  return s;
}

function signed(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

beforeEach(() => {
  inserted = [];
});

describe("POST /api/events — the GitHub branch", () => {
  it("captures a signed webhook without any bearer token", async () => {
    const body = JSON.stringify({
      action: "closed",
      pull_request: { number: 7, merged: true },
      repository: { full_name: "re-cinq/lore" },
    });

    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: {
        "x-hub-signature-256": signed(body),
        "x-github-event": "pull_request",
        "x-github-delivery": "d-1",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    expect(inserted.map((e) => e.source)).toEqual(inserted.map(() => "github"));
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("refuses a webhook whose signature does not match the secret", async () => {
    const body = JSON.stringify({ action: "closed" });

    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: {
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
        "x-github-event": "pull_request",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(inserted).toEqual([]);
  });
});

describe("POST /api/events — the bearer branch", () => {
  const event = {
    eventName: "kubernetes.agent_node.succeeded",
    source: "kubernetes",
    params: { assemblyLineId: "line-1", nodeId: "review" },
    dedupeKey: "cr-1:Succeeded",
  };

  it("inserts a reported event verbatim for a valid bearer token", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: JSON.stringify(event),
    });

    expect(res.statusCode).toBe(202);
    expect(inserted).toEqual([event]);
  });

  it("refuses a reported event carrying no bearer token", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      payload: JSON.stringify(event),
    });

    expect(res.statusCode).toBe(401);
    expect(inserted).toEqual([]);
  });

  it("refuses a source outside the known vocabulary", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: JSON.stringify({ ...event, source: "typo" }),
    });

    expect(res.statusCode).toBe(400);
    expect(inserted).toEqual([]);
  });

  it("refuses a body that is not JSON, naming the ingress that rejected it", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: "{not json",
    });

    expect(res.statusCode).toBe(400);
    expect((res.result as { error: string }).error).toMatch(
      /invalid JSON in event body/,
    );
    expect(inserted).toEqual([]);
  });

  it("reports every event a single webhook fans out to", async () => {
    const body = JSON.stringify({
      action: "completed",
      check_suite: {
        head_sha: "abc",
        pull_requests: [{ number: 1 }, { number: 2 }],
      },
      repository: { full_name: "re-cinq/lore" },
    });

    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: {
        "x-hub-signature-256": signed(body),
        "x-github-event": "check_suite",
        "x-github-delivery": "d-2",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    expect(inserted.map((e) => e.params?.pr_number)).toEqual([1, 2]);
  });

  it("names the body itself when the payload is not even an object", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/events",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: "[]",
    });

    expect(res.statusCode).toBe(400);
    expect((res.result as { error: string }).error).toMatch(/\(body\)/);
    expect(inserted).toEqual([]);
  });
});
