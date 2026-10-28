// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getImplementationLoop } = await import("./backlog");

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

describe("getImplementationLoop", () => {
  it("reads the repo's implementation-loop surface", async () => {
    await getImplementationLoop("re-cinq/lore");

    expect(String(call()[0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/implementation-loop",
    );
  });
});
