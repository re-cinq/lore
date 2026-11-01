import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import {
  repoParam,
  resolveRepo,
  withRepo,
  type ServerMode,
} from "../shared/repo-scope.js";

const ingestFilesInput = (mode: ServerMode) => ({
  files: z.array(z.string()).describe("Repo-relative file paths to ingest."),
  repo: repoParam(mode),
});

interface IngestCredentials {
  apiUrl: string;
  apiToken: string;
}

interface IngestOutcome {
  ingested: boolean;
  message: string;
}

export function registerIngestFilesTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_ingest_files",
    `Fetches specific repo files from GitHub, embeds them, and writes them into Lore's context store immediately so they are searchable without waiting for nightly ingestion. Returns "Ingested N files into Lore for <repo>. M errors." Use after merging a new ADR or updated CLAUDE.md to make it searchable now. Instead: to onboard a new repo use lore_onboard_repo; to search existing content use lore_search_context or lore_assemble_context.`,
    ingestFilesInput(mode),
    async ({ files, repo }) => {
      try {
        return await withRepo({ repo }, mode, (a) =>
          ingestFiles(files, mode, a.repo),
        );
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

async function ingestFiles(
  files: string[],
  mode: ServerMode,
  resolvedRepo: string,
) {
  const credentials = ingestCredentials();

  if (!credentials) {
    return textResult(
      "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
    );
  }
  const commit = await resolveCommitSha(resolvedRepo, mode);
  const outcome = await postIngest(credentials, files, resolvedRepo, commit);

  if (outcome.ingested) {
    invalidateCache(["lore_assemble_context"], resolvedRepo);
  }

  return textResult(outcome.message);
}

function ingestCredentials(): IngestCredentials | null {
  const { LORE_API_URL: apiUrl, LORE_INGEST_TOKEN: apiToken } = process.env;

  return apiUrl && apiToken ? { apiUrl, apiToken } : null;
}

async function resolveCommitSha(
  resolvedRepo: string,
  mode: ServerMode,
): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");

    if (resolveRepo(undefined, mode) !== resolvedRepo) {
      return "HEAD";
    }

    return execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "HEAD";
  }
}

async function postIngest(
  credentials: IngestCredentials,
  files: string[],
  resolvedRepo: string,
  commit: string,
): Promise<IngestOutcome> {
  const res = await fetch(`${credentials.apiUrl}/api/ingest`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ files, repo: resolvedRepo, commit }),
  });

  return parseIngestResponse(res, resolvedRepo);
}

async function parseIngestResponse(
  res: Response,
  resolvedRepo: string,
): Promise<IngestOutcome> {
  if (res.ok) {
    const result = (await res.json()) as { ingested?: number; errors?: number };

    return {
      ingested: true,
      message: `Ingested ${result.ingested || 0} files into Lore for ${resolvedRepo}. ${result.errors || 0} errors.`,
    };
  }
  const err = await res.json().catch(() => ({ error: res.statusText }));

  return {
    ingested: false,
    message: `Ingestion failed: ${(err as { error?: string }).error || res.statusText}`,
  };
}
