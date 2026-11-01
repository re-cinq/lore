import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerWriteEpisodeTool } from "./write-episode.js";

const writeEpisode = toolHandlers(registerWriteEpisodeTool, "full")[
  "lore_write_episode"
];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  vi.stubEnv("LORE_AGENT_ID", "agent-7");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lore_write_episode", () => {
  it("posts the episode for the ambient agent agent-7 to /api/episode and prints the API's answer", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", episode_id: "e1" }),
    });

    const result = await writeEpisode({
      content: "we moved to pgvector",
      source: "session",
    });
    const [url, opts] = fetchMock.mock.calls[0];

    expect({
      url,
      sent: JSON.parse((opts as { body: string }).body),
      printed: JSON.parse(result.content[0].text),
    }).toMatchObject({
      url: "https://lore-api.example.com/api/episode",
      sent: {
        content: "we moved to pgvector",
        source: "session",
        agent_id: "agent-7",
      },
      printed: { status: "ok", episode_id: "e1" },
    });
  });

  it("keeps the agent_id agent-9 the call names", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await writeEpisode({ content: "c", source: "s", agent_id: "agent-9" });

    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
    ).toMatchObject({ agent_id: "agent-9" });
  });

  it("says episodes need the API when LORE_API_URL is unset", async () => {
    vi.stubEnv("LORE_API_URL", "");

    const result = await writeEpisode({ content: "c", source: "s" });

    expect(result.content[0].text).toBe(
      "Episodes require PostgreSQL or LORE_API_URL. Neither is configured.",
    );
  });
});
