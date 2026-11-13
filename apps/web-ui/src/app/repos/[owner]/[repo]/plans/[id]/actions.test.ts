// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const session = vi.fn();
const canAccess = vi.fn();

vi.mock("@/lib/session", () => ({ getSession: () => session() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("@/lib/user-repo-access", () => ({
  userCanAccessRepo: () => canAccess(),
}));

const {
  approvePlanAction,
  deletePlanAction,
  openPlanSocketAction,
  refinePlanAction,
  draftAgainAction,
  generatePrototypeAction,
  reopenPlanAction,
  retrySpecWorkAction,
  reworkSpecsAction,
  mintPlanRunTokenAction,
  savePlanStoryAction,
  removePlanStoryAction,
} = await import("./actions");

const GEDAIU = {
  login: "gedaiu",
  user: { name: "Bogdan" },
  accessToken: "gho_x",
};

let fetchMock: ReturnType<typeof vi.fn>;

const answer = (status: number, body: object) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  session.mockResolvedValue(GEDAIU);
  canAccess.mockResolvedValue(true);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openPlanSocketAction", () => {
  it("hands gedaiu a token minted for plan p1 and the plan's document name", async () => {
    answer(200, { token: "t1", documentName: "plan:re-cinq/lore:p1" });

    expect(await openPlanSocketAction("re-cinq/lore", "p1")).toEqual({
      token: "t1",
      documentName: "plan:re-cinq/lore:p1",
    });
  });

  it("mints nothing for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await openPlanSocketAction("re-cinq/lore", "p1"),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      fetched: 0,
    });
  });

  it("asks a visitor without a session to sign in", async () => {
    session.mockResolvedValue(null);

    expect(await openPlanSocketAction("re-cinq/lore", "p1")).toEqual({
      error: "Sign in to open this plan.",
    });
  });
});

describe("approvePlanAction", () => {
  it("approves plan p1 in gedaiu's name through lore's route", async () => {
    answer(200, { id: "p1", status: "approved" });

    expect({
      result: await approvePlanAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
      body: JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body),
      ) as unknown,
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/approve",
      body: { approvedBy: "gedaiu" },
    });
  });

  it("reports a plan lore-api refuses to approve as not ready", async () => {
    answer(409, { error: "plan p1 is not ready for approval", problems: [] });

    expect(await approvePlanAction("re-cinq/lore", "p1")).toEqual({
      error: "The plan is not ready to approve yet.",
    });
  });

  it("counts unresolved findings among the refusal problems", async () => {
    answer(409, {
      error: "plan p1 is not ready for approval",
      problems: [
        {
          code: "unresolved-finding",
          slot: "s1",
          blockId: "b1",
          message: "m1",
        },
        {
          code: "unresolved-finding",
          slot: "s2",
          blockId: "b2",
          message: "m2",
        },
        { code: "empty-required-section", slot: "s3" },
      ],
    });

    expect(await approvePlanAction("re-cinq/lore", "p1")).toEqual({
      error:
        "The plan has 2 unresolved findings; resolve them before approving.",
    });
  });

  it("reports lore-api's reason when the planning agent is still refining a section", async () => {
    answer(409, { error: "the planning agent is still refining a section" });

    expect(await approvePlanAction("re-cinq/lore", "p1")).toEqual({
      error: "The planning agent is still refining a section.",
    });
  });
});

describe("reopenPlanAction", () => {
  it("reopens plan p1 in gedaiu's name", async () => {
    answer(200, { id: "p1", status: "draft" });

    expect({
      result: await reopenPlanAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
      body: JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body),
      ) as unknown,
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/reopen",
      body: { reopenedBy: "gedaiu" },
    });
  });

  it("reports lore-api's reason for refusing to reopen a plan that is not approved", async () => {
    answer(409, { error: "the plan is not approved" });

    expect(await reopenPlanAction("re-cinq/lore", "p1")).toEqual({
      error: "The plan is not approved.",
    });
  });
});

describe("deletePlanAction", () => {
  it("deletes plan p1 of re-cinq/lore and goes back to the repo's plans", async () => {
    answer(200, { id: "p1" });

    await expect(deletePlanAction("re-cinq/lore", "p1")).rejects.toThrow(
      new Error("redirect /repos/re-cinq/lore/plans"),
    );
    expect({
      url: String(fetchMock.mock.calls[0][0]),
      method: (fetchMock.mock.calls[0][1] as RequestInit).method,
    }).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1",
      method: "DELETE",
    });
  });

  it("deletes nothing for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await deletePlanAction("re-cinq/lore", "p1"),
      calls: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      calls: 0,
    });
  });

  it("reports lore-api's reason when plan p1 is not found", async () => {
    answer(404, { error: "plan not found" });

    expect(await deletePlanAction("re-cinq/lore", "p1")).toEqual({
      error: "Plan not found.",
    });
  });
});

describe("retrySpecWorkAction", () => {
  it("starts a fresh spec pass for plan p1 in gedaiu's name", async () => {
    answer(202, { task_id: "t3" });

    expect({
      result: await retrySpecWorkAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
      body: JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body),
      ) as unknown,
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/spec-work",
      body: { createdBy: "gedaiu" },
    });
  });

  it("starts nothing for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await retrySpecWorkAction("re-cinq/lore", "p1"),
      calls: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      calls: 0,
    });
  });
});

describe("reworkSpecsAction", () => {
  it("reworks plan p1's specs from the review in gedaiu's name", async () => {
    answer(202, { run_id: "r1" });

    expect({
      result: await reworkSpecsAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
      body: JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body),
      ) as unknown,
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/spec-rework",
      body: { actor: "gedaiu" },
    });
  });

  it("reports lore-api's reason when nothing on the spec PR waits for the writer", async () => {
    answer(409, { error: "nothing on the spec PR is waiting for the writer" });

    expect(await reworkSpecsAction("re-cinq/lore", "p1")).toEqual({
      error: "Nothing on the spec PR is waiting for the writer.",
    });
  });
});

describe("generatePrototypeAction", () => {
  it("asks the sketch agent to draw plan p1's Prototype section in gedaiu's name", async () => {
    answer(202, { run_id: "r1" });

    expect({
      result: await generatePrototypeAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
      body: JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body),
      ) as unknown,
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/prototype",
      body: { actor: "gedaiu" },
    });
  });

  it("reports lore-api's reason when the planning agent is still working on plan p1", async () => {
    answer(409, { error: "the planning agent is still working on this plan" });

    expect(await generatePrototypeAction("re-cinq/lore", "p1")).toEqual({
      error: "The planning agent is still working on this plan.",
    });
  });
});

describe("refinePlanAction", () => {
  const REFINE = {
    slot: "intent",
    title: "Intent",
    baseHash: "3f9a",
    inputs: {},
    uses: {},
  };

  it("asks the planning agent to refine the intent section of plan p1", async () => {
    answer(202, { ok: true });

    expect({
      result: await refinePlanAction("re-cinq/lore", "p1", REFINE),
      url: String(fetchMock.mock.calls[0][0]),
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/refine",
    });
  });

  it("reports a Refine lore-api refuses while the agent is still drafting", async () => {
    answer(409, { error: "the planning agent is still working on this plan" });

    expect(await refinePlanAction("re-cinq/lore", "p1", REFINE)).toEqual({
      error: "The planning agent is still working on this plan.",
    });
  });

  it("reports lore-api's reason when approved plan p1's sections are settled", async () => {
    answer(409, {
      error:
        "the plan is approved, so its sections are settled; reopen the plan to write again",
    });

    expect(await refinePlanAction("re-cinq/lore", "p1", REFINE)).toEqual({
      error:
        "The plan is approved, so its sections are settled; reopen the plan to write again.",
    });
  });
});

describe("draftAgainAction", () => {
  it("asks the planning agent for a fresh draft of plan p1 in gedaiu's name", async () => {
    answer(202, { task_id: "t2" });

    expect({
      result: await draftAgainAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
      body: JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body),
      ) as unknown,
    }).toEqual({
      result: {},
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/drafting",
      body: { known: "", createdBy: "gedaiu" },
    });
  });

  it("starts no draft for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await draftAgainAction("re-cinq/lore", "p1"),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      fetched: 0,
    });
  });
});

describe("mintPlanRunTokenAction", () => {
  it("mints gedaiu a plan-run token for plan p1 of re-cinq/lore", async () => {
    answer(200, { token: "t2", expires_at: "2026-11-06T10:10:00.000Z" });

    expect({
      result: await mintPlanRunTokenAction("re-cinq/lore", "p1"),
      url: String(fetchMock.mock.calls[0][0]),
    }).toEqual({
      result: { token: "t2" },
      url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/run-stream-token",
    });
  });

  it("mints no plan-run token for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await mintPlanRunTokenAction("re-cinq/lore", "p1"),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      fetched: 0,
    });
  });

  it("says the run could not be loaded when lore-api refuses the mint", async () => {
    answer(404, { error: "plan not found" });

    expect(await mintPlanRunTokenAction("re-cinq/lore", "p1")).toEqual({
      error: "Could not load the planning run.",
    });
  });
});

const sentToLoreApi = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)) as unknown,
  }));

describe("savePlanStoryAction", () => {
  it("saves story 456 on plan p1 from the issue URL of re-cinq/lore, set by gedaiu", async () => {
    answer(200, { issueNumber: 456, issueUrl: "u" });

    expect({
      result: await savePlanStoryAction(
        "re-cinq/lore",
        "p1",
        "https://github.com/re-cinq/lore/issues/456",
      ),
      sent: sentToLoreApi(),
    }).toEqual({
      result: {},
      sent: [
        {
          url: "http://api:3000/api/plans/p1/story",
          body: { issueNumber: 456, setBy: "gedaiu" },
        },
      ],
    });
  });

  it("saves nothing and names the repo when the story is issue 42 of other/repo", async () => {
    expect({
      result: await savePlanStoryAction(
        "re-cinq/lore",
        "p1",
        "https://github.com/other/repo/issues/42",
      ),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "The user story must be an issue of re-cinq/lore." },
      fetched: 0,
    });
  });

  it("saves nothing for a blank story", async () => {
    expect({
      result: await savePlanStoryAction("re-cinq/lore", "p1", " "),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: {
        error: "The user story must be a GitHub issue URL or its number.",
      },
      fetched: 0,
    });
  });

  it("saves nothing for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await savePlanStoryAction("re-cinq/lore", "p1", "456"),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      fetched: 0,
    });
  });

  it("says lore-api's reason when the save is refused", async () => {
    answer(404, { error: "plan not found" });

    expect(await savePlanStoryAction("re-cinq/lore", "p1", "456")).toEqual({
      error: "Plan not found.",
    });
  });
});

describe("removePlanStoryAction", () => {
  it("saves the removal of plan p1's story, set by gedaiu", async () => {
    answer(200, { issueNumber: null, issueUrl: null });

    expect({
      result: await removePlanStoryAction("re-cinq/lore", "p1"),
      sent: sentToLoreApi(),
    }).toEqual({
      result: {},
      sent: [
        {
          url: "http://api:3000/api/plans/p1/story",
          body: { issueNumber: null, setBy: "gedaiu" },
        },
      ],
    });
  });

  it("removes nothing for someone GitHub does not let see the repo", async () => {
    canAccess.mockResolvedValue(false);

    expect({
      result: await removePlanStoryAction("re-cinq/lore", "p1"),
      fetched: fetchMock.mock.calls.length,
    }).toEqual({
      result: { error: "You do not have access to this repo." },
      fetched: 0,
    });
  });
});
