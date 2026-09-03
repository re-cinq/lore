import { describe, it, expect } from "vitest";
import type { ServerRoute } from "@hapi/hapi";
import { routeList } from "../server/build-server.js";
import { bearerScope } from "../server/plugins/bearer-scope.js";
import {
  generateOpenApi,
  normalizePath,
  undeclaredWildcards,
} from "./build-document.js";

const routes = routeList(() => null);
const isApi = (r: ServerRoute) => r.path.startsWith("/api/");
const { document, coverage } = generateOpenApi(routes);

function allOperations() {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).map(([method, op]) => ({ path, method, op })),
  );
}

describe("OpenAPI coverage drift guard", () => {
  it("leaves no live write route uncovered", () => {
    expect(coverage.uncovered).toEqual([]);
  });

  it("catches a new body-bearing route that declares neither a schema nor a sidecar entry", () => {
    const naked: ServerRoute = {
      method: "POST",
      path: "/api/__drift_probe__",
      options: bearerScope("write"),
      handler: () => null,
    };
    const probe = generateOpenApi([naked]);

    expect(probe.coverage.uncovered).toEqual(["POST /api/__drift_probe__"]);
  });

  it("documents every /api/* route's path exactly once, dropping none", () => {
    const expected = new Set(
      routes.filter(isApi).map((r) => normalizePath(r.path)),
    );

    expect(new Set(Object.keys(document.paths))).toEqual(expected);
  });

  it("gives a multiplexed path one contract per verb, not one union across both", () => {
    const schemaOf = (path: string, method: string) =>
      JSON.stringify(
        (
          document.paths[path] as Record<
            string,
            { responses: Record<string, unknown> }
          >
        )[method].responses["200"],
      );

    for (const path of [
      "/api/tokens",
      "/api/repos/{owner}/{repo}/settings/dark-factory",
    ]) {
      const verbs = Object.keys(document.paths[path]);

      expect(verbs).toHaveLength(2);
      expect(schemaOf(path, verbs[0])).not.toEqual(schemaOf(path, verbs[1]));
    }
  });

  it("names every wildcard route as serving verbs or as refusing them", () => {
    expect(undeclaredWildcards(routes)).toEqual([]);

    const probe: ServerRoute = {
      method: "*",
      path: "/api/tokens/{id}",
      options: bearerScope("admin"),
      handler: () => null,
    };

    expect(undeclaredWildcards([...routes, probe])).toEqual([
      "/api/tokens/{id}",
    ]);
  });

  it("documents no operation for a wildcard route that only answers 405", () => {
    expect(Object.keys(document.paths["/api/tokens"]).sort()).toEqual([
      "get",
      "post",
    ]);
  });

  it("excludes only the operational non-API paths", () => {
    expect(coverage.excluded.every((p) => !p.startsWith("/api/"))).toBe(true);
    expect(
      Object.keys(document.paths).every((p) => p.startsWith("/api/")),
    ).toBe(true);
  });

  it("assigns every operation exactly one declared category, none uncategorized", () => {
    const declared = new Set(document.tags.map((t) => t.name));

    for (const { path, method, op } of allOperations()) {
      expect(op.tags, `${method} ${path} tags`).toHaveLength(1);
      expect(
        declared.has(op.tags[0]),
        `${method} ${path} -> ${op.tags[0]}`,
      ).toBe(true);
    }
  });
});

describe("OpenAPI document is structurally valid 3.1", () => {
  it("has the 3.1 envelope, info, security scheme, and error components", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toMatchObject({
      title: expect.any(String),
      version: expect.any(String),
    });
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });
    expect(document.components.schemas.Error).toBeDefined();
  });

  it("gives every operation a security declaration and a responses object", () => {
    for (const { path, method, op } of allOperations()) {
      expect(op.security, `${method} ${path} security`).toBeDefined();
      expect(op.responses, `${method} ${path} responses`).toBeDefined();
      expect(
        op["x-rate-limit-bucket"],
        `${method} ${path} bucket`,
      ).toBeDefined();
    }
  });

  it("shapes every request body as an application/json schema", () => {
    for (const { op } of allOperations()) {
      if (op.requestBody && !hasRawNdjsonBody(op.requestBody)) {
        expect(op.requestBody.content).toHaveProperty(["application/json"]);
      }
    }
  });
});

describe("Features responses are declaratively described", () => {
  const featureOps = Object.entries(document.paths).flatMap(
    ([path, pathItem]) =>
      Object.entries(pathItem as Record<string, { tags: string[] }>)
        .filter(([, op]) => op.tags?.[0] === "Features")
        .map(([method, op]) => ({
          label: `${method.toUpperCase()} ${path}`,
          op,
        })),
  );

  it("finds the Features surface at all", () => {
    expect(featureOps.length).toBeGreaterThan(0);
  });

  it("gives every Features operation a schema'd success body", () => {
    for (const { label, op } of featureOps) {
      const responses = (
        op as unknown as { responses: Record<string, unknown> }
      ).responses;
      const hit = Object.entries(responses).find(([code]) =>
        code.startsWith("2"),
      );

      expect(hit, `${label} has no 2xx`).toBeDefined();
      expect(hit?.[1], `${label} success body`).toHaveProperty([
        "content",
        "application/json",
      ]);
    }
  });

  it("resolves every Features success schema to a registered component", () => {
    for (const { label, op } of featureOps) {
      const responses = (
        op as unknown as { responses: Record<string, unknown> }
      ).responses;
      const [, success] = Object.entries(responses).find(([c]) =>
        c.startsWith("2"),
      )!;
      const ref = (
        success as {
          content: { "application/json": { schema: { $ref?: string } } };
        }
      ).content["application/json"].schema.$ref;

      expect(ref, `${label} $ref`).toBeDefined();
      expect(
        document.components.schemas[ref!.split("/").pop()!],
        `${label} -> ${ref}`,
      ).toBeDefined();
    }
  });
});

function hasRawNdjsonBody(body: unknown): boolean {
  const content = (body as { content?: Record<string, unknown> }).content;

  return Boolean(content?.["application/x-ndjson"]);
}
