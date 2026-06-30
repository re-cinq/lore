/**
 * `GET /dist/lore-code-trace/<os>-<arch>` (+ `/checksums.txt`) — serves the
 * portable test-ingestion binary that ships baked into this image. Onboarded
 * repos' CI downloads it from the host they already have (`LORE_INGEST_URL`),
 * so the binary always matches the deployed ingestion contract. Public (no auth):
 * the artifact is a generic, secret-free tool. A strict allowlist (not path
 * joining of arbitrary input) makes traversal structurally impossible.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DIST_PREFIX = "/dist/lore-code-trace/";
const ALLOWED = new Set(["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64", "checksums.txt"]);

/** The requested artifact name iff it is on the allowlist, else null. */
export function parseDistArtifact(url: string): string | null {
  if (!url.startsWith(DIST_PREFIX)) return null;
  const name = url.slice(DIST_PREFIX.length).split("?")[0];
  return ALLOWED.has(name) ? name : null;
}

function distDir(): string {
  return process.env.LORE_DIST_DIR || "/app/dist-bin";
}

export async function handleDistRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const artifact = parseDistArtifact(req.url || "");
  if (!artifact) {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unknown artifact" }));
    return;
  }

  let data: Buffer;
  try {
    data = await readFile(join(distDir(), artifact));
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "artifact not built into this image" }));
    return;
  }

  const isText = artifact.endsWith(".txt");
  res.writeHead(200, {
    "Content-Type": isText ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Content-Length": String(data.length),
    "Content-Disposition": `attachment; filename="${artifact === "checksums.txt" ? "checksums.txt" : "lore-code-trace"}"`,
  });
  res.end(data);
}
