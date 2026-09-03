/** Write OpenAPI document to openapi.json (ADR-035); determinism required (no serverUrl/timestamp/pool). */

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
  // Root format job pushes json reformat; unformatted artifact would drift on every PR.
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
