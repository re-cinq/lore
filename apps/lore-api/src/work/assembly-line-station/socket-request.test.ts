import { describe, it, expect } from "vitest";
import Hapi, { type Request } from "@hapi/hapi";
import { answerRequest } from "./socket-request.js";

function lore() {
  const server = Hapi.server();
  const asAna = (request: Request) =>
    request.headers.authorization === "Bearer ana-session";

  server.route([
    {
      method: "GET",
      path: "/api/floor-runs",
      handler: (request, h) =>
        asAna(request)
          ? { rows: [{ id: "r1" }] }
          : h.response({ error: "invalid token" }).code(401),
    },
    {
      method: "POST",
      path: "/api/echo",
      handler: (request) => request.payload as object,
    },
    {
      method: "GET",
      path: "/api/admin-only",
      handler: (_, h) => h.response({ error: "insufficient scope" }).code(403),
    },
    {
      method: "GET",
      path: "/api/auth/me",
      handler: () => ({ login: "ana" }),
    },
    {
      method: "GET",
      path: "/metrics",
      handler: () => ({ scraped: true }),
    },
    {
      method: "GET",
      path: "/api/plain-text",
      handler: () => "not json",
    },
  ]);

  return (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    session: string | undefined = "ana-session",
    body?: unknown,
  ) =>
    answerRequest(
      { type: "request", id: "q1", method, path, body },
      session,
      (options) => server.inject(options),
    );
}

describe("answerRequest", () => {
  it("answers Ana's GET /api/floor-runs over the socket with the route's 200 and rows", async () => {
    expect(await lore()("GET", "/api/floor-runs")).toEqual({
      type: "response",
      id: "q1",
      status: 200,
      body: { rows: [{ id: "r1" }] },
    });
  });

  it("answers 401 to a request on a socket with no session", async () => {
    expect(await lore()("GET", "/api/floor-runs", "")).toMatchObject({
      status: 401,
      body: { error: "no session" },
    });
  });

  it("answers 404 to a request for /api/auth/me, /api/webhook/github, /api/ws, an escaped /api/%61uth/me and a malformed path", async () => {
    const paths = [
      "/api/auth/me",
      "/api/webhook/github",
      "/api/ws",
      "/api/%61uth/me",
      "/api/%E0%A4%A",
    ];
    const ask = lore();

    expect(
      (await Promise.all(paths.map((path) => ask("GET", path)))).map(
        (answer) => answer.status,
      ),
    ).toEqual([404, 404, 404, 404, 404]);
  });

  it("answers 404 to /api/../metrics, which leaves the api once its dots are resolved", async () => {
    expect((await lore()("GET", "/api/../metrics")).status).toBe(404);
  });

  it("answers the route's 403 untouched", async () => {
    expect(await lore()("GET", "/api/admin-only")).toMatchObject({
      status: 403,
      body: { error: "insufficient scope" },
    });
  });

  it("sends the body of a POST to the route", async () => {
    expect(
      await lore()("POST", "/api/echo", "ana-session", { a: 1 }),
    ).toMatchObject({ status: 200, body: { a: 1 } });
  });

  it("answers a payload that is not JSON as a string", async () => {
    expect(await lore()("GET", "/api/plain-text")).toMatchObject({
      status: 200,
      body: "not json",
    });
  });
});
