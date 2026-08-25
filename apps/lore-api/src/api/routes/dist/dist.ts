import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
/**
 * `GET /dist/lore-code-trace/<os>-<arch>` (+ `/checksums.txt`) — serves the
 * portable test-ingestion binary that ships baked into this image. Onboarded
 * repos' CI downloads it from the host they already have (`LORE_INGEST_URL`),
 * so the binary always matches the deployed ingestion contract. Public (no auth):
 * the artifact is a generic, secret-free tool. A strict allowlist (not path
 * joining of arbitrary input) makes traversal structurally impossible.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerRoute } from "@hapi/hapi";
import { errorMessage } from "@re-cinq/lore-shared";

const DIST_PREFIX = "/dist/lore-code-trace/";
const ALLOWED = new Set(["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64", "checksums.txt"]);

/** The requested artifact name iff it is on the allowlist, else null. */
export function parseDistArtifact(url: string): string | null {
  if (!url.startsWith(DIST_PREFIX)) {return null;}
  const name = url.slice(DIST_PREFIX.length).split("?")[0];

  return ALLOWED.has(name) ? name : null;
}

function distDir(): string {
  return process.env.LORE_DIST_DIR || "/app/dist-bin";
}

export function distRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/dist/lore-code-trace/{artifact*}",
    options: { auth: false },
    handler: async (request, h) => {
      const artifact = parseDistArtifact(request.path);

      enforceTrue(artifact, apiError(404), "unknown artifact");

      let data: Buffer;

      try {
        data = await readFile(join(distDir(), artifact));
      } catch (err) {
        console.warn(`[dist] artifact read failed: ${errorMessage(err)}`);

        return h.response({ error: "artifact not built into this image" }).code(404);
      }

      const isText = artifact.endsWith(".txt");

      return h
        .response(data)
        .type(isText ? "text/plain; charset=utf-8" : "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${artifact === "checksums.txt" ? "checksums.txt" : "lore-code-trace"}"`);
    },
  };
}
