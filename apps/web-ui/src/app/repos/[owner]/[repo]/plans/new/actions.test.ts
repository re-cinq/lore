// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({
  getSession: async () => ({ login: "gedaiu", user: { name: "Bogdan" } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { createPlanAction } = await import("./actions");

let fetchMock: ReturnType<typeof vi.fn>;

const form = (fields: Record<string, string>) => {
  const formData = new FormData();

  Object.entries(fields).forEach(([key, value]) => formData.set(key, value));

  return formData;
};

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)) as unknown,
  }));

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          meta: { id: "p1" },
          documentName: "plan:re-cinq/lore:p1",
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("createPlanAction", () => {
  it("asks for a title and creates nothing when the title is blank", async () => {
    const result = await createPlanAction(
      "re-cinq/lore",
      null,
      form({ title: " ", type: "feature" }),
    );

    expect({ result, fetched: fetchMock.mock.calls.length }).toEqual({
      result: { error: "A plan needs a title." },
      fetched: 0,
    });
  });

  it("creates gedaiu's feature plan, seeds its intent, and opens it", async () => {
    await expect(
      createPlanAction(
        "re-cinq/lore",
        null,
        form({
          title: "Faster checkout",
          type: "feature",
          description: "Checkout is slow.",
        }),
      ),
    ).rejects.toThrow(new Error("redirect /repos/re-cinq/lore/plans/p1"));
    expect(calls()).toEqual([
      {
        url: "http://api:3000/api/plans",
        body: {
          repo: "re-cinq/lore",
          title: "Faster checkout",
          type: "feature",
          createdBy: "gedaiu",
        },
      },
      {
        url: "http://api:3000/api/plans/p1/agent-edits",
        body: {
          actor: "gedaiu",
          ops: [
            {
              op: "set-section-text",
              slot: "intent",
              paragraphs: ["Checkout is slow."],
            },
          ],
        },
      },
      {
        url: "http://api:3000/api/repos/re-cinq/lore/plans/p1/drafting",
        body: { known: "Checkout is slow.", createdBy: "gedaiu" },
      },
    ]);
  });

  it("leaves the template's intent alone when the description is empty", async () => {
    await expect(
      createPlanAction(
        "re-cinq/lore",
        null,
        form({ title: "Faster checkout", type: "feature", description: "" }),
      ),
    ).rejects.toThrow(new Error("redirect /repos/re-cinq/lore/plans/p1"));
    expect(calls().map((call) => call.url)).toEqual([
      "http://api:3000/api/plans",
      "http://api:3000/api/repos/re-cinq/lore/plans/p1/drafting",
    ]);
  });
});
