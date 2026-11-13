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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPlanAction failures", () => {
  it("A seed or draft-start API failure is shown with its reason and does not produce a success-only redirect", async () => {
    fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/agent-edits")) {
        return new Response(JSON.stringify({ message: "Seed intent failed" }), {
          status: 500,
        });
      }

      return new Response(JSON.stringify({ meta: { id: "p1" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPlanAction(
      "re-cinq/lore",
      null,
      form({ title: "Faster checkout", type: "feature", description: "Hello" }),
    );

    expect(result).toEqual({ error: "Seed intent failed", planId: "p1" });
  });

  it("A retry does not create a duplicate plan", async () => {
    fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ meta: { id: "p1" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const prevState = { error: "Seed intent failed", planId: "p1" };

    await expect(
      createPlanAction(
        "re-cinq/lore",
        prevState as any,
        form({
          title: "Faster checkout",
          type: "feature",
          description: "Hello",
        }),
      ),
    ).rejects.toThrow(new Error("redirect /repos/re-cinq/lore/plans/p1"));

    const apiCalls = calls();

    expect(apiCalls.some((c) => c.url === "http://api:3000/api/plans")).toBe(
      false,
    );
    expect(apiCalls.map((c) => c.url)).toEqual([
      "http://api:3000/api/plans/p1/agent-edits",
      "http://api:3000/api/repos/re-cinq/lore/plans/p1/drafting",
    ]);
  });
});
