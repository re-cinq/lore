// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const session = vi.fn();
const canAccess = vi.fn();

vi.mock("@/lib/session", () => ({ getSession: () => session() }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo: () => canAccess() }));

const { approvePlanAction, openPlanSocketAction } = await import("./actions");

const GEDAIU = { login: "gedaiu", user: { name: "Bogdan" }, accessToken: "gho_x" };

let fetchMock: ReturnType<typeof vi.fn>;

const answer = (status: number, body: object) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  process.env.LORE_PLANS_WS_URL = "wss://lore-api.example/api/plans/collab";
  session.mockResolvedValue(GEDAIU);
  canAccess.mockResolvedValue(true);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
  delete process.env.LORE_PLANS_WS_URL;
});

describe("openPlanSocketAction", () => {
  it("hands gedaiu the public socket and a token minted for plan p1", async () => {
    answer(200, { token: "t1", documentName: "plan:re-cinq/lore:p1" });

    expect(await openPlanSocketAction("re-cinq/lore", "p1")).toEqual({
      wsUrl: "wss://lore-api.example/api/plans/collab",
      token: "t1",
      documentName: "plan:re-cinq/lore:p1",
    });
  });

  it("mints nothing for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await openPlanSocketAction("re-cinq/lore", "p1"),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({ result: { error: "You do not have access to this repo." }, fetched: 0 });
  });

  it("names the missing LORE_PLANS_WS_URL when no socket address is configured", async () => {
    delete process.env.LORE_PLANS_WS_URL;
    delete process.env.LORE_API_URL;

    expect(await openPlanSocketAction("re-cinq/lore", "p1")).toEqual({
      error: "The plan socket is not configured (LORE_PLANS_WS_URL).",
    });
  });

  it("asks a visitor without a session to sign in", async () => {
    session.mockResolvedValue(null);

    expect(await openPlanSocketAction("re-cinq/lore", "p1")).toEqual({ error: "Sign in to open this plan." });
  });
});

describe("approvePlanAction", () => {
  it("approves plan p1 in gedaiu's name", async () => {
    answer(200, { id: "p1", status: "approved" });

    expect({
      result: await approvePlanAction("re-cinq/lore", "p1"),
      body: JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as unknown,
    }).toEqual({ result: {}, body: { approvedBy: "gedaiu" } });
  });

  it("reports a plan lore-api refuses to approve as not ready", async () => {
    answer(409, { type: "urn:planning:plan-not-approvable" });

    expect(await approvePlanAction("re-cinq/lore", "p1")).toEqual({ error: "The plan is not ready to approve yet." });
  });
});
