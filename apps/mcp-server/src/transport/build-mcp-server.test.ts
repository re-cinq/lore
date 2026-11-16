import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./build-mcp-server.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function connected(serverMode: "agent" | "full") {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });

  await buildMcpServer({ serverMode }).connect(serverSide);
  await client.connect(clientSide);

  return client;
}

describe("buildMcpServer", () => {
  it("names its version after the LORE_BUILD_SHA it was built from", async () => {
    vi.stubEnv("LORE_BUILD_SHA", "abc1234");

    const client = await connected("agent");

    expect(client.getServerVersion()?.version).toBe("abc1234");
  });

  it("names its version dev outside an image", async () => {
    vi.stubEnv("LORE_BUILD_SHA", "");

    const client = await connected("full");

    expect(client.getServerVersion()?.version).toBe("dev");
  });

  it("carries the session rules, the self-update offer among them, in its instructions", async () => {
    const client = await connected("full");

    expect(client.getInstructions()).toEqual(
      expect.stringContaining("lore_mcp_update_available"),
    );
  });

  it("serves lore_versions on the gateway too", async () => {
    const client = await connected("agent");
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toContain("lore_versions");
  });
});
