import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
/** Serves portable lore-code-trace binary from strict allowlist; always matches deployed contract. */

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

      let binary: Buffer;

      try {
        binary = await readFile(join(distDir(), artifact));
      } catch (err) {
        console.warn(`[dist] artifact read failed: ${errorMessage(err)}`);

        return h.response({ error: "artifact not built into this image" }).code(404);
      }

      const isText = artifact.endsWith(".txt");

      return h
        .response(binary)
        .type(isText ? "text/plain; charset=utf-8" : "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${artifact === "checksums.txt" ? "checksums.txt" : "lore-code-trace"}"`);
    },
  };
}
