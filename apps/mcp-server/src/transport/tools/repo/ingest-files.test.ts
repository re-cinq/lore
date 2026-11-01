import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
}));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { registerIngestFilesTool } from "./ingest-files.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

const originalEnv = { ...process.env };

function handlerFor(name: string, mode: ServerMode = "full") {
  return toolHandlers(registerIngestFilesTool, mode)[name];
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
    const handler = handlerFor("lore_ingest_files");
    const result = await handler({ files: ["CLAUDE.md"] });

    expect(result.content[0].text).toEqual(
      "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
    );
  });

  it("returns a config-required message when LORE_API_URL / token are unset", async () => {
    const handler = handlerFor("lore_ingest_files");
    const result = await handler({
      files: ["CLAUDE.md"],
      repo: "re-cinq/lore",
    });

    expect(result.content[0].text).toEqual(
      "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
    );
  });

  describe("with LORE_API_URL / LORE_INGEST_TOKEN configured", () => {
    beforeEach(() => {
      process.env.LORE_API_URL = "https://lore-api.example";
      process.env.LORE_INGEST_TOKEN = "test-token";
    });

    it("sends HEAD as the commit when the matching repo's directory is not a git checkout", async () => {
      const outside = mkdtempSync(join(tmpdir(), "lore-ingest-"));

      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
      let capturedBody: { commit?: string } = {};
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementation(async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body));

          return new Response("{}", { status: 200 });
        });

      const previous = process.cwd();

      process.chdir(outside);
      const result = await handlerFor("lore_ingest_files")({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      process.chdir(previous);
      rmSync(outside, { recursive: true, force: true });
      fetchSpy.mockRestore();

      expect({
        commit: capturedBody.commit,
        text: result.content[0].text,
      }).toEqual({
        commit: "HEAD",
        text: "Ingested 0 files into Lore for re-cinq/lore. 0 errors.",
      });
    });

    it("surfaces the status text when a non-ok JSON response names no error", async () => {
      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/other");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("{}", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      const result = await handlerFor("lore_ingest_files")({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      fetchSpy.mockRestore();

      expect(result.content[0].text).toBe(
        "Ingestion failed: Internal Server Error",
      );
    });

    it("surfaces the status text when a non-ok ingest response is not JSON", async () => {
      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/other");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("<html>bad gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }),
      );

      const result = await handlerFor("lore_ingest_files")({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      fetchSpy.mockRestore();

      expect(result.content[0].text).toBe("Ingestion failed: Bad Gateway");
    });

    it("uses the real local HEAD commit when the detected repo matches the target", async () => {
      const { execSync } = await import("node:child_process");
      const expectedHead = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
      }).trim();

      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
      let capturedBody: { commit?: string } = {};
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementation(async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body));

          return new Response(JSON.stringify({ ingested: 1, errors: 0 }), {
            status: 200,
          });
        });

      const handler = handlerFor("lore_ingest_files");
      const result = await handler({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      expect(capturedBody.commit).toEqual(expectedHead);
      expect(result.content[0].text).toEqual(
        "Ingested 1 files into Lore for re-cinq/lore. 0 errors.",
      );
      fetchSpy.mockRestore();
    });

    it("falls back to HEAD as the commit when the detected repo differs from the target", async () => {
      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/other");
      let capturedBody: { commit?: string } = {};
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementation(async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body));

          return new Response(JSON.stringify({ ingested: 2, errors: 1 }), {
            status: 200,
          });
        });

      const handler = handlerFor("lore_ingest_files");
      const result = await handler({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      expect(capturedBody.commit).toEqual("HEAD");
      expect(result.content[0].text).toEqual(
        "Ingested 2 files into Lore for re-cinq/lore. 1 errors.",
      );
      fetchSpy.mockRestore();
    });

    it("surfaces a non-ok ingest response's error message", async () => {
      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "quota exceeded" }), {
          status: 429,
        }),
      );

      const handler = handlerFor("lore_ingest_files");
      const result = await handler({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      expect(result.content[0].text).toEqual(
        "Ingestion failed: quota exceeded",
      );
      fetchSpy.mockRestore();
    });

    it("reports the caught error message when the ingest request itself throws", async () => {
      vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockRejectedValue(new Error("network down"));

      const handler = handlerFor("lore_ingest_files");
      const result = await handler({
        files: ["CLAUDE.md"],
        repo: "re-cinq/lore",
      });

      expect(result.content[0].text).toEqual("Error: network down");
      fetchSpy.mockRestore();
    });
  });
});

describe("lore_ingest_files in the agent gateway, which has no checkout", () => {
  it("asks for the repo as owner/name instead of trying to detect one", async () => {
    const result = await handlerFor(
      "lore_ingest_files",
      "agent",
    )({
      files: ["CLAUDE.md"],
    });

    expect({
      text: result.content[0].text,
      gitAsked: vi.mocked(detectCurrentRepo).mock.calls.length,
    }).toEqual({
      text: "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
      gitAsked: 0,
    });
  });
});
