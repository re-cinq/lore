/**
 * Write the OpenAPI document to `apps/lore-api/openapi.json` (ADR-035).
 *
 * The document existed only in memory and as the body of `GET /api/openapi.json`,
 * so nothing could generate from it. The committed artifact is what
 * `openapi-typescript` turns into the web UI's client types — replacing 162 lines
 * of hand-mirrored interfaces.
 *
 * DETERMINISM IS THE WHOLE POINT. A drift guard compares a regenerated file to the
 * committed one, so anything environmental in the output makes the check noise
 * rather than signal: no `serverUrl` (`LORE_API_URL` differs per environment), no
 * timestamp, no pool. `routeList(() => null)` is safe because generation reads
 * route metadata only — no handler runs.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateOpenApi } from "./build-document.js";
import { routeList } from "../server/build-server.js";

export function openApiArtifactPath(): string {
  return resolve(import.meta.dirname, "../../openapi.json");
}

function generate(): void {
  const dest = openApiArtifactPath();
  const { document, coverage } = generateOpenApi(routeList(() => null));

  writeFileSync(dest, `${JSON.stringify(document, null, 2)}\n`);
  // Prettier formats the repo's json too, and the root `format` job PUSHES its
  // reformat — an unformatted artifact would drift against itself on every PR.
  execFileSync("npx", ["--no-install", "prettier", "--write", dest], {
    stdio: "ignore",
  });
  console.log(
    `[gen-openapi] wrote ${dest} — ${Object.keys(document.paths).length} paths, ` +
      `${coverage.responses.length} declared response schemas`,
  );
}

// Only write when invoked as the CLI: a bare import must have no side effects.
const argv1 = process.argv[1] ?? "";

if (argv1.endsWith("gen-openapi.js") || argv1.endsWith("gen-openapi.ts")) {
  generate();
}
