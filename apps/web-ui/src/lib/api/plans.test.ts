// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { listPlans, createPlan, readPlan, approvePlan, mintCollabToken, seedPlan } =
  await import("./plans");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

const request = () => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

  return {
    url,
    method: init.method,
    body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined,
  };
};

describe("plans client", () => {
  it("lists re-cinq/lore's plans from the repo's plans collection", async () => {
    await listPlans("re-cinq/lore");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans",
      method: "GET",
      body: undefined,
    });
  });

  it("creates a feature plan for re-cinq/lore written by gedaiu", async () => {
    await createPlan({ repo: "re-cinq/lore", title: "Faster checkout", type: "feature", createdBy: "gedaiu" });

    expect(request()).toEqual({
      url: "http://api:3000/api/plans",
      method: "POST",
      body: { repo: "re-cinq/lore", title: "Faster checkout", type: "feature", createdBy: "gedaiu" },
    });
  });

  it("reads plan p1 from the plans API", async () => {
    await readPlan("p1");

    expect(request()).toEqual({ url: "http://api:3000/api/plans/p1", method: "GET", body: undefined });
  });

  it("approves plan p1 in gedaiu's name", async () => {
    await approvePlan("p1", "gedaiu");

    expect(request()).toEqual({
      url: "http://api:3000/api/plans/p1/approve",
      method: "POST",
      body: { approvedBy: "gedaiu" },
    });
  });

  it("mints a write collab token on plan p1 of re-cinq/lore for gedaiu", async () => {
    await mintCollabToken("re-cinq/lore", "p1", { id: "gedaiu", name: "Bogdan" }, "write");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/collab-token",
      method: "POST",
      body: { user: { id: "gedaiu", name: "Bogdan" }, role: "write" },
    });
  });

  it("seeds plan p1's intent with gedaiu's two paragraphs", async () => {
    await seedPlan("p1", "gedaiu", ["Checkout is slow.", "Mobile users drop off."]);

    expect(request()).toEqual({
      url: "http://api:3000/api/plans/p1/agent-edits",
      method: "POST",
      body: {
        actor: "gedaiu",
        ops: [{ op: "set-section-text", slot: "intent", paragraphs: ["Checkout is slow.", "Mobile users drop off."] }],
      },
    });
  });
});
