// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  listPlans,
  createPlan,
  readPlan,
  approvePlan,
  reopenPlan,
  deletePlan,
  startSpecWork,
  mintCollabToken,
  seedPlan,
  startDrafting,
  askRefine,
} = await import("./plans");

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
    await createPlan({
      repo: "re-cinq/lore",
      title: "Faster checkout",
      type: "feature",
      createdBy: "gedaiu",
    });

    expect(request()).toEqual({
      url: "http://api:3000/api/plans",
      method: "POST",
      body: {
        repo: "re-cinq/lore",
        title: "Faster checkout",
        type: "feature",
        createdBy: "gedaiu",
      },
    });
  });

  it("reads plan p1 from the plans API", async () => {
    await readPlan("p1");

    expect(request()).toEqual({
      url: "http://api:3000/api/plans/p1",
      method: "GET",
      body: undefined,
    });
  });

  it("approves plan p1 of re-cinq/lore in gedaiu's name through lore's own route", async () => {
    await approvePlan("re-cinq/lore", "p1", "gedaiu");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/approve",
      method: "POST",
      body: { approvedBy: "gedaiu" },
    });
  });

  it("reopens plan p1 of re-cinq/lore in gedaiu's name", async () => {
    await reopenPlan("re-cinq/lore", "p1", "gedaiu");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/reopen",
      method: "POST",
      body: { reopenedBy: "gedaiu" },
    });
  });

  it("deletes plan p1 of re-cinq/lore through lore's own route", async () => {
    await deletePlan("re-cinq/lore", "p1");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1",
      method: "DELETE",
      body: undefined,
    });
  });

  it("starts a fresh spec pass for plan p1 of re-cinq/lore in gedaiu's name", async () => {
    await startSpecWork("re-cinq/lore", "p1", "gedaiu");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/spec-work",
      method: "POST",
      body: { createdBy: "gedaiu" },
    });
  });

  it("mints a write collab token on plan p1 of re-cinq/lore for gedaiu", async () => {
    await mintCollabToken(
      "re-cinq/lore",
      "p1",
      { id: "gedaiu", name: "Bogdan" },
      "write",
    );

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/collab-token",
      method: "POST",
      body: { user: { id: "gedaiu", name: "Bogdan" }, role: "write" },
    });
  });

  it("seeds plan p1's intent with gedaiu's two paragraphs", async () => {
    await seedPlan("p1", "gedaiu", [
      "Checkout is slow.",
      "Mobile users drop off.",
    ]);

    expect(request()).toEqual({
      url: "http://api:3000/api/plans/p1/agent-edits",
      method: "POST",
      body: {
        actor: "gedaiu",
        ops: [
          {
            op: "set-section-text",
            slot: "intent",
            paragraphs: ["Checkout is slow.", "Mobile users drop off."],
          },
        ],
      },
    });
  });

  it("asks for the planning agent's draft of plan p1, handing over what gedaiu knows", async () => {
    await startDrafting("re-cinq/lore", "p1", "Checkout is slow.", "gedaiu");

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/drafting",
      method: "POST",
      body: { known: "Checkout is slow.", createdBy: "gedaiu" },
    });
  });

  it("asks the planning agent to refine the intent section of plan p1", async () => {
    const refine = {
      slot: "intent",
      title: "Intent",
      baseHash: "3f9a",
      inputs: {},
      uses: {},
    };

    await askRefine("re-cinq/lore", "p1", refine);

    expect(request()).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/refine",
      method: "POST",
      body: refine,
    });
  });
});
