import { errorMessage } from "@re-cinq/lore-shared";
// Serves the generated OpenAPI 3.1 doc (ADR-035); /api/docs inlines it since a browser can't attach a bearer to a second cross-origin fetch.

import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { buildOpenApiDocument } from "../../../openapi/build-document.js";

const REDOC_CDN =
  "https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js";

/** The full route table, incl. these two docs routes themselves — supplied by the caller (build-server.ts owns `routeList`) rather than imported, so generating the doc never needs the module that assembles it. */
type RouteListFn = (getPool: () => Pool | null) => ServerRoute[];

const generate = (getPool: () => Pool | null, routeList: RouteListFn) =>
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

export function openApiJsonRoute(
  getPool: () => Pool | null,
  routeList: RouteListFn,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/openapi.json",
    options: bearerScope("read"),
    handler: (_request, h) => {
      try {
        return h.response(generate(getPool, routeList));
      } catch (err) {
        console.error("[openapi] generation failed:", errorMessage(err));

        return h
          .response({ error: "failed to generate openapi document" })
          .code(500);
      }
    },
  };
}

export function docsRoute(
  getPool: () => Pool | null,
  routeList: RouteListFn,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/docs",
    options: bearerScope("read"),
    handler: (_request, h) => {
      try {
        return h
          .response(docsHtml(generate(getPool, routeList)))
          .type("text/html");
      } catch (err) {
        console.error("[openapi] docs render failed:", errorMessage(err));

        return h.response({ error: "failed to render docs" }).code(500);
      }
    },
  };
}
