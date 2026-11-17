import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProxyResult } from "../shared/deps.js";
import {
  type ApiGet,
  partError,
  readParts,
  readRun,
  runPath,
} from "./shared/run-read.js";
import { BLOB_HASH, RUN_ID } from "./shared/run-params.js";

export const GET_RUN_ASSETS_DESCRIPTION =
  "Lists what an assembly-line run produced, returning {bag, previews, pull_files}: each bag item by name with its kind (value, file or git), ref and the station that put it there, the first 4 KiB of every blob the bag refers to, and the pull request's changed files. Instead: lore_get_run_blob for a whole blob.";

const MAX_PREVIEWS = 50;

type Bag = { bag?: Record<string, { ref: string }> };

export function registerGetRunAssetsTool(server: McpServer) {
  server.tool(
    "lore_get_run_assets",
    GET_RUN_ASSETS_DESCRIPTION,
    { run_id: RUN_ID },
    ({ run_id }) =>
      readRun({
        tool: "lore_get_run_assets",
        op: "getting run assets",
        load: (get) => runAssets(get, run_id),
      }),
  );
}

async function runAssets(get: ApiGet, runId: string): Promise<ProxyResult> {
  const parts = await readParts(get, {
    required: { bag: runPath(runId, "/bag") },
    optional: { pull_files: runPath(runId, "/pull-files") },
  });

  if (!parts.ok) {
    return parts;
  }
  const assets = JSON.parse(parts.body) as { bag: Bag; pull_files: unknown };
  const previews = await blobPreviews(get, runId, blobHashes(assets.bag));

  return {
    ok: true,
    body: JSON.stringify({
      bag: assets.bag.bag ?? {},
      previews,
      pull_files: assets.pull_files,
    }),
  };
}

function blobHashes(bag: Bag): string[] {
  const refs = Object.values(bag.bag ?? {}).map((bagItem) => bagItem.ref);

  return [...new Set(refs.filter((ref) => BLOB_HASH.test(ref)))].slice(
    0,
    MAX_PREVIEWS,
  );
}

async function blobPreviews(
  get: ApiGet,
  runId: string,
  hashes: string[],
): Promise<unknown> {
  if (!hashes.length) {
    return {};
  }
  const query = new URLSearchParams(hashes.map((hash) => ["hash", hash]));
  const previews = await get(runPath(runId, `/blob-previews?${query}`));

  return previews.ok
    ? (JSON.parse(previews.body) as { previews: unknown }).previews
    : partError(previews);
}
