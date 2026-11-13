import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reportGatewayVersion } from "./report-gateway-version.js";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reportGatewayVersion", () => {
  it("posts the lore-mcp build and its MCP SDK version to /api/service-versions", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));

    await reportGatewayVersion({ LORE_BUILD_SHA: "abc1234" });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];

    expect({ url, body: JSON.parse(init.body) }).toEqual({
      url: "https://lore-api.example.com/api/service-versions",
      body: {
        service: "lore-mcp",
        build: "abc1234",
        packages: { "@modelcontextprotocol/sdk": expect.any(String) },
      },
    });
  });

  it("resolves when lore-api refuses the report", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));

    await expect(reportGatewayVersion({})).resolves.toBe(undefined);
  });
});
