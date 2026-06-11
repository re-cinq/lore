import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Drives the registered lore_ingest_files handler via a fake McpServer. Only the
 * deterministic guard branches are covered here — the success path is a live
 * fetch to LORE_API_URL and is left to integration. detectCurrentRepo is
 * mocked so the "could not detect repo" branch is reachable without a git
 * remote.
 */
vi.mock("../../features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
}));

import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { registerRepoTools } from "./repo-tools.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

const originalEnv = { ...process.env };

function ingestFilesHandler(getPool: () => unknown): ToolHandler {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    },
  };
  registerRepoTools(fakeServer as never, { getPool });
  return handlers["lore_ingest_files"];
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("lore_ingest_files", () => {
  beforeEach(() => {
    delete process.env.LORE_API_URL;
    delete process.env.LORE_INGEST_TOKEN;
  });

  it("returns a detect-repo message when no repo is given and detection fails", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue(null);
    const handler = ingestFilesHandler(() => null);
    const result = await handler({ files: ["CLAUDE.md"] });
    expect(result.content[0].text).toEqual(
      "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
    );
  });

  it("returns a config-required message when LORE_API_URL / token are unset", async () => {
    const handler = ingestFilesHandler(() => null);
    const result = await handler({ files: ["CLAUDE.md"], repo: "re-cinq/lore" });
    expect(result.content[0].text).toEqual(
      "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
    );
  });
});
