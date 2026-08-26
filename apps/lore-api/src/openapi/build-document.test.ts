import { describe, it, expect } from "vitest";
import { routeList } from "../server/build-server.js";
import { generateOpenApi, buildOpenApiDocument } from "./build-document.js";

const { document, coverage } = generateOpenApi(
  routeList(() => null),
  { version: "9.9.9", serverUrl: "https://lore-api.test" },
);
const bodySchema = (op: Record<string, any>) =>
  op?.requestBody?.content?.["application/json"]?.schema;

describe("generateOpenApi — envelope", () => {
  it("is an OpenAPI 3.1 document with info, servers, and the bearerAuth scheme", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info).toMatchObject({
      title: "Lore API",
      version: "9.9.9",
    });
    expect(document.servers).toEqual([{ url: "https://lore-api.test" }]);
    expect(Object.keys(document.components.securitySchemes)).toEqual([
      "bearerAuth",
    ]);
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });
  });

  it("buildOpenApiDocument returns just the document", () => {
    expect(buildOpenApiDocument(routeList(() => null)).openapi).toBe("3.1.0");
  });

  it("defaults servers to the relative root when no serverUrl is given", () => {
    expect(buildOpenApiDocument(routeList(() => null)).servers).toEqual([
      { url: "/" },
    ]);
  });
});

describe("generateOpenApi — coverage", () => {
  it("leaves no write route uncovered (every one is schema, lifted, or allowlisted freeform)", () => {
    expect(coverage.uncovered).toEqual([]);
  });

  it("excludes the operational non-API paths", () => {
    expect(coverage.excluded).toEqual(
      expect.arrayContaining(["/healthz", "/dist/lore-code-trace/{artifact*}"]),
    );
    expect(document.paths["/healthz"]).toBeUndefined();
  });

  it("records tokens + features POSTs as documented freeform", () => {
    expect(coverage.freeform).toEqual(
      expect.arrayContaining([
        "POST /api/tokens",
        "POST /api/repos/{owner}/{repo}/features",
      ]),
    );
  });

  it("records the lifted domain schemas (agents, dark-factory)", () => {
    expect(coverage.lifted).toEqual(
      expect.arrayContaining([
        "POST /api/repos/{owner}/{repo}/agent-definitions",
        "PUT /api/repos/{owner}/{repo}/settings/dark-factory",
      ]),
    );
  });
});

describe("generateOpenApi — request bodies", () => {
  it("renders the memory discriminated union as anyOf", () => {
    expect(bodySchema(document.paths["/api/memory"].post)).toMatchObject({
      anyOf: expect.any(Array),
    });
    expect(
      bodySchema(document.paths["/api/memory"].post).$schema,
    ).toBeUndefined();
  });

  it("carries required fields through for a flat covered route (ingest)", () => {
    const schema = bodySchema(document.paths["/api/ingest"].post);

    expect(schema.required).toContain("repo");
    expect(schema.properties.repo).toMatchObject({ type: "string" });
  });

  it("lifts the agents zod schema (name is a kebab-case string)", () => {
    const schema = bodySchema(
      document.paths["/api/repos/{owner}/{repo}/agent-definitions"].post,
    );

    expect(schema.properties.name).toMatchObject({ type: "string" });
  });

  it("documents features + tokens POSTs as a permissive object", () => {
    expect(
      bodySchema(document.paths["/api/repos/{owner}/{repo}/features"].post),
    ).toEqual({
      type: "object",
      additionalProperties: true,
    });
    expect(bodySchema(document.paths["/api/tokens"].post)).toEqual({
      type: "object",
      additionalProperties: true,
    });
  });
});

describe("generateOpenApi — methods, scope, security", () => {
  it("expands method:* routes to their real verbs", () => {
    expect(Object.keys(document.paths["/api/tokens"]).sort()).toEqual([
      "get",
      "post",
    ]);
    expect(
      Object.keys(
        document.paths["/api/repos/{owner}/{repo}/settings/dark-factory"],
      ).sort(),
    ).toEqual(["get", "put"]);
  });

  it("merges verbs at a shared path and normalizes the optional param", () => {
    const p =
      document.paths["/api/repos/{owner}/{repo}/agent-definitions/{name}"];

    expect(Object.keys(p).sort()).toEqual(["delete", "get", "put"]);
    expect(p.get.description).toMatch(/optional/i);
    expect(p.get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "name", in: "path", required: true }),
      ]),
    );
  });

  it("carries per-route scope and rate-limit bucket as extensions", () => {
    expect(document.paths["/api/memory"].post).toMatchObject({
      "x-required-scope": "write",
      "x-rate-limit-bucket": "default",
      security: [{ bearerAuth: [] }],
    });
    expect(document.paths["/api/task"].post).toMatchObject({
      "x-required-scope": "task",
      "x-rate-limit-bucket": "task",
    });
  });

  it("marks HMAC webhook operations as public (security: []) in the webhook bucket", () => {
    expect(document.paths["/api/webhook/slack"].post).toMatchObject({
      security: [],
      "x-rate-limit-bucket": "webhook",
    });
    expect(
      document.paths["/api/webhook/slack"].post["x-required-scope"],
    ).toBeUndefined();
  });
});

describe("generateOpenApi — tag grouping", () => {
  it("declares the sidebar categories in canonical order, only those in use", () => {
    expect(document.tags.map((t) => t.name)).toEqual([
      "Context",
      "Memory",
      "Tasks",
      "Repositories",
      "Features",
      "Agents",
      "Ingestion",
      "Traceability",
      "Dark Factory",
      "Webhooks",
      "Analytics",
      "Tokens",
      "Cluster Agents",
      "Meta",
    ]);
    expect(document.tags.every((t) => t.description.length > 0)).toBe(true);
  });

  it("tags a representative operation from each resource", () => {
    expect(document.paths["/api/task"].post.tags).toEqual(["Tasks"]);
    expect(document.paths["/api/memory"].post.tags).toEqual(["Memory"]);
    expect(document.paths["/api/context"].get.tags).toEqual(["Context"]);
    expect(document.paths["/api/repos"].get.tags).toEqual(["Repositories"]);
    expect(
      document.paths["/api/repos/{owner}/{repo}/features"].post.tags,
    ).toEqual(["Features"]);
    expect(
      document.paths["/api/repos/{owner}/{repo}/agent-definitions"].post.tags,
    ).toEqual(["Agents"]);
    expect(
      document.paths["/api/repos/{owner}/{repo}/settings/dark-factory"].get
        .tags,
    ).toEqual(["Dark Factory"]);
    expect(
      document.paths["/api/repos/{owner}/{repo}/ingest-graph"].post.tags,
    ).toEqual(["Ingestion"]);
    expect(
      document.paths["/api/repos/{owner}/{repo}/impact"].post.tags,
    ).toEqual(["Traceability"]);
    expect(document.paths["/api/webhook/slack"].post.tags).toEqual([
      "Webhooks",
    ]);
    expect(document.paths["/api/tokens"].post.tags).toEqual(["Tokens"]);
    expect(document.paths["/api/openapi.json"].get.tags).toEqual(["Meta"]);
  });
});

describe("generateOpenApi — responses", () => {
  it("references the shared error envelope for a write route", () => {
    const responses = document.paths["/api/memory"].post.responses;

    expect(responses["400"]).toEqual({
      $ref: "#/components/responses/BadRequest",
    });
    expect(responses["401"]).toEqual({
      $ref: "#/components/responses/Unauthorized",
    });
    expect(responses["429"]).toEqual({
      $ref: "#/components/responses/RateLimited",
    });
    expect(document.components.schemas.Error).toMatchObject({
      required: ["error"],
    });
  });
});

describe("generateOpenApi — raw-body relay routes (options.app.rawBody)", () => {
  it("carries the relay's own description and an x-ndjson request body instead of the HMAC boilerplate", () => {
    const op = document.paths["/api/task-turns/{taskId}"].post;

    expect(op.description).toContain("Raw NDJSON body");
    expect(op.description).not.toContain("HMAC");
    expect(op.requestBody).toEqual({
      required: true,
      content: { "application/x-ndjson": { schema: { type: "string" } } },
    });
  });
});
