import { errorMessage } from "@re-cinq/lore-shared";
/**
 * Serve the generated OpenAPI 3.1 document (ADR-035).
 *
 * - `GET /api/openapi.json` (read scope) — the document itself, generated from the
 *   live `routeList` at request time so it never drifts from the running server.
 * - `GET /api/docs` (read scope) — a Redoc page. Because a browser cannot attach a
 *   bearer to a second cross-origin fetch, the document is **inlined** into the
 *   page (`Redoc.init(spec, …)`): one read-scoped gate, no second request.
 *
 * Both routes live in `routeList`, so the document describes itself. `routeList`
 * is imported lazily (used only inside the handlers) — the build-server ↔ this
 * cycle is resolved at call time, never at module load.
 */

import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { buildOpenApiDocument } from "../../../openapi/build-document.js";
import { routeList } from "../../../server/build-server.js";

const REDOC_CDN =
  "https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js";

const generate = (getPool: () => Pool | null) =>
  buildOpenApiDocument(routeList(getPool), {
    serverUrl: process.env.LORE_API_URL,
  });

/** Inline the spec safely inside a <script> — neutralize `</script>` / `<!--`. */
function docsHtml(spec: object): string {
  const json = JSON.stringify(spec).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Lore API — Reference</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <div id="redoc"></div>
    <script src="${REDOC_CDN}"></script>
    <script>
      Redoc.init(${json}, {}, document.getElementById("redoc"));
    </script>
  </body>
</html>`;
}

export function openApiJsonRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/openapi.json",
    options: bearerScope("read"),
    handler: (_request, h) => {
      try {
        return h.response(generate(getPool));
      } catch (err) {
        console.error("[openapi] generation failed:", errorMessage(err));

        return h
          .response({ error: "failed to generate openapi document" })
          .code(500);
      }
    },
  };
}

export function docsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/docs",
    options: bearerScope("read"),
    handler: (_request, h) => {
      try {
        return h.response(docsHtml(generate(getPool))).type("text/html");
      } catch (err) {
        console.error("[openapi] docs render failed:", errorMessage(err));

        return h.response({ error: "failed to render docs" }).code(500);
      }
    },
  };
}
