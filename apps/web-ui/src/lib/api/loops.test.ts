// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getRepoLoops, setLoopEnabled } = await import("./loops");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = () => fetchMock.mock.calls[0];

describe("getRepoLoops", () => {
  it("reads the repo's loops", async () => {
    await getRepoLoops("re-cinq/lore");

    expect(String(call()[0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/loops",
    );
  });
});

describe("setLoopEnabled", () => {
  it("PUTs {enabled:false} to the triage loop's own path", async () => {
    await setLoopEnabled("re-cinq/lore", "triage", { enabled: false });

    expect({
      url: String(call()[0]),
      method: call()[1].method,
      body: JSON.parse(call()[1].body as string),
    }).toEqual({
      url: "http://api:3000/api/repos/re-cinq/lore/loops/triage",
      method: "PUT",
      body: { enabled: false },
    });
  });
});
