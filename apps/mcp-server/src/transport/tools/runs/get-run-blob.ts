import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRun, runPath } from "./shared/run-read.js";
import { BLOB_HASH, RUN_ID } from "./shared/run-params.js";

export const GET_RUN_BLOB_DESCRIPTION =
  "Reads one blob an assembly-line run refers to, returning {hash, contentType, size, text, truncated}: the text of a textual blob up to 1 MiB, only the metadata otherwise. hash comes from lore_get_run_assets. A blob never changes, so it is cached for a day.";

const GET_RUN_BLOB_INPUT = {
  run_id: RUN_ID,
  hash: z
    .string()
    .regex(BLOB_HASH)
    .describe("The blob's hash, sha256-<64 hex>."),
};

export function registerGetRunBlobTool(server: McpServer) {
  server.tool(
    "lore_get_run_blob",
    GET_RUN_BLOB_DESCRIPTION,
    GET_RUN_BLOB_INPUT,
    ({ run_id, hash }) =>
      readRun({
        tool: "lore_get_run_blob",
        op: "getting run blob",
        load: (get) => get(runPath(run_id, `/blobs/${hash}`)),
        cache: { args: { run_id, hash }, ttlSeconds: 86400 },
      }),
  );
}
