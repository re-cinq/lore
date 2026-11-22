// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getMe = vi.fn();
const getRepo = vi.fn();

vi.mock("./lib/api/auth", () => ({ getMe }));
vi.mock("./lib/api/repos", () => ({ getRepo }));

const { default: middleware, config } = await import("./middleware");
const { unstable_doesMiddlewareMatch: guards } =
  await import("next/experimental/testing/server");

const guarded = (url: string) => guards({ config, url });

function request(
  path: string,
  cookie?: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`https://lore.example.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...init.headers,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "lore.example.com",
      ...(cookie ? { cookie: `lore_session=${cookie}` } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getRepo.mockResolvedValue({ status: "error", message: "none", code: 404 });
});

describe("middleware", () => {
  it("sends a request with no session cookie to sign in without asking lore-api", async () => {
    const response = await middleware(request("/settings"));

    expect({
      status: response.status,
      location: response.headers.get("location"),
      asked: getMe.mock.calls.length,
    }).toEqual({
      status: 307,
      location: "https://lore.example.com/auth/signin?next=%2Fsettings",
      asked: 0,
    });
  });

  it.each([401, 403])(
    "sends a cookie lore-api refuses with %i to sign in and drops it",
    async (code) => {
      getMe.mockResolvedValue({ status: "error", message: "no", code });

      const response = await middleware(
        request("/api/repos/acme/app/file?path=README.md", "made-up"),
      );

      expect({
        status: response.status,
        location: response.headers.get("location"),
        cookie: response.headers.get("set-cookie"),
      }).toEqual({
        status: 307,
        location: expect.stringContaining("/auth/signin?next="),
        cookie: expect.stringMatching(/^lore_session=;/),
      });
    },
  );

  it.each([
    ["lore-api cannot be reached", { status: "error", message: "down" }],
    ["lore-api answers 500", { status: "error", message: "boom", code: 500 }],
    ["no lore-api is configured", { status: "unconfigured" }],
  ])("answers 503 and lets nothing through when %s", async (_case, answer) => {
    getMe.mockResolvedValue(answer);

    const response = await middleware(request("/settings", "tok"));

    expect({
      status: response.status,
      next: response.headers.get("x-middleware-next"),
    }).toEqual({ status: 503, next: null });
  });

  it.each([
    ["GET", "/auth/signin"],
    ["HEAD", "/auth/signin"],
    ["GET", "/auth/error"],
    ["GET", "/auth/start"],
    ["GET", "/auth/callback"],
    ["POST", "/auth/signout"],
    ["GET", "/api/auth/session"],
    ["GET", "/api/version"],
  ])(
    "lets %s %s through with no session and without asking lore-api",
    async (method, path) => {
      const response = await middleware(request(path, undefined, { method }));

      expect({
        next: response.headers.get("x-middleware-next"),
        asked: getMe.mock.calls.length,
      }).toEqual({ next: "1", asked: 0 });
    },
  );

  it.each([
    ["POST", "/auth/signin", {}],
    ["POST", "/auth/error", {}],
    ["POST", "/auth/callback", {}],
    ["GET", "/auth/signout", {}],
    ["GET", "/auth/signin", { "next-action": "abc123" }],
    ["POST", "/auth/signout", { "next-action": "abc123" }],
    ["GET", "/auth/unknown", {}],
    ["GET", "/api/auth/other", {}],
  ])(
    "holds %s %s to a session when it could carry a Server Action or names no public route",
    async (method, path, headers) => {
      const response = await middleware(
        request(path, undefined, { method, headers }),
      );

      expect({
        next: response.headers.get("x-middleware-next"),
        location: response.headers.get("location"),
      }).toEqual({
        next: null,
        location: expect.stringContaining("/auth/signin?next="),
      });
    },
  );

  it("answers a refused POST with 303, so the action it carries is not replayed at the sign-in page", async () => {
    getMe.mockResolvedValue({ status: "error", message: "no", code: 401 });

    const refused = await middleware(
      request("/settings", "made-up", { method: "POST" }),
    );
    const missing = await middleware(
      request("/settings", undefined, { method: "POST" }),
    );

    expect([refused.status, missing.status]).toEqual([303, 303]);
  });

  it("gives the repository lookup the same deadline as the session check", async () => {
    getMe.mockResolvedValue({ status: "ok", data: { login: "ada" } });

    await middleware(request("/repos/acme/app", "tok"));

    expect(getRepo.mock.calls[0]).toEqual([
      "acme/app",
      { token: "tok", timeoutMs: 10_000 },
    ]);
  });

  it("gives the session check a deadline of 10 seconds", async () => {
    getMe.mockResolvedValue({ status: "ok", data: { login: "ada" } });

    await middleware(request("/settings", "tok"));

    expect(getMe.mock.calls[0][0]).toEqual({ token: "tok", timeoutMs: 10_000 });
  });

  it("lets a session lore-api knows through, asked with the cookie's token", async () => {
    getMe.mockResolvedValue({ status: "ok", data: { login: "ada" } });

    const response = await middleware(request("/settings", "tok"));

    expect({
      next: response.headers.get("x-middleware-next"),
      token: getMe.mock.calls[0][0].token,
    }).toEqual({ next: "1", token: "tok" });
  });
});

describe("the paths the middleware guards", () => {
  it.each([
    "/",
    "/settings",
    "/repos/acme/app",
    "/repos/acme/app.png",
    "/repos/acme/private/specs/secret.png",
    "/repos/acme/private/specs/secret.svg",
    "/api/repos/acme/app/file",
    "/api/repos/acme/app.png/file",
    "/api/tasks/1/pr-status",
    "/api/version/x.png",
    "/authx",
    "/authorize/x",
    "/api/authz",
    "/auth/signin",
    "/auth/callback",
    "/api/auth/session",
    "/api/version",
    "/onboard",
    "/anything/lore-logo.svg/more",
    "/_next/imagex/y",
  ])("runs for %s", (path) => {
    expect(guarded(path)).toBe(true);
  });

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
    "/icon.svg",
    "/lore-logo.svg",
    "/lore-logo-dark.svg",
  ])("leaves %s to Next without running", (path) => {
    expect(guarded(path)).toBe(false);
  });
});
