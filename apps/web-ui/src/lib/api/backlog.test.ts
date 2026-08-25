// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getImplementationLoop, setImplementationLoopEnabled } =
  await import("./backlog");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
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

describe("setImplementationLoopEnabled", () => {
  it("PUTs the enabled flag to the same path", async () => {
    await setImplementationLoopEnabled("re-cinq/lore", true);

    expect(String(call()[0])).toBe(
      "http://api:3000/api/repos/re-cinq/lore/implementation-loop",
    );
    expect(call()[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(call()[1].body as string)).toEqual({ enabled: true });
  });
});
