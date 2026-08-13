import { describe, it, expect } from "vitest";
import type { ServerRoute } from "@hapi/hapi";
import { routeList } from "../server/build-server.js";
import { bearerScope } from "../server/plugins/bearer-scope.js";
import { generateOpenApi, normalizePath } from "./build-document.js";

/**
 * Drift guard (ADR-035, fork 5). The document is generated from the live
 * `routeList`, so a new route that carries a body but declares no schema — and is
 * not a documented sidecar exception — fails here. The doc cannot silently rot.
 */

const routes = routeList(() => null);
const isApi = (r: ServerRoute) => r.path.startsWith("/api/");
const { document, coverage } = generateOpenApi(routes);

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

  it("excludes only the operational non-API paths", () => {
    expect(coverage.excluded.every((p) => !p.startsWith("/api/"))).toBe(true);
    expect(
      Object.keys(document.paths).every((p) => p.startsWith("/api/")),
    ).toBe(true);
  });

  it("assigns every operation exactly one declared category, none uncategorized", () => {
    const declared = new Set(document.tags.map((t) => t.name));

    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        expect(op.tags, `${method} ${path} tags`).toHaveLength(1);
        expect(
          declared.has(op.tags[0]),
          `${method} ${path} -> ${op.tags[0]}`,
        ).toBe(true);
      }
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
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item)) {
        expect(op.security, `${method} ${path} security`).toBeDefined();
        expect(op.responses, `${method} ${path} responses`).toBeDefined();
        expect(
          op["x-rate-limit-bucket"],
          `${method} ${path} bucket`,
        ).toBeDefined();
      }
    }
  });

  it("shapes every request body as an application/json schema", () => {
    for (const item of Object.values(document.paths)) {
      for (const op of Object.values(item)) {
        if (op.requestBody) {
          expect(op.requestBody.content).toHaveProperty(["application/json"]);
        }
      }
    }
  });
});

describe("Features responses are declaratively described", () => {
  const featureOps = Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, { tags: string[] }>)
      .filter(([, op]) => op.tags?.[0] === "Features")
      .map(([method, op]) => ({ label: `${method.toUpperCase()} ${path}`, op })),
  );

  it("finds the Features surface at all", () => {
    expect(featureOps.length).toBeGreaterThan(0);
  });

  // Scoped to the Features tag ON PURPOSE. The other ~40 routes are
  // request-focused by design (info.description says so), so a document-wide
  // assertion would red-light them for a contract they never claimed. Widen the
  // tag list as each surface adopts zodResponse — never by weakening this.
  it("gives every Features operation a schema'd success body", () => {
    for (const { label, op } of featureOps) {
      const responses = (op as unknown as { responses: Record<string, unknown> })
        .responses;
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
      const responses = (op as unknown as { responses: Record<string, unknown> })
        .responses;
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
