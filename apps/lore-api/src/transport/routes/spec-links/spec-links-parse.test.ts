import { describe, it, expect } from "vitest";
import Hapi from "@hapi/hapi";
import { specLinksParseRoute } from "./spec-links-parse.js";

async function server() {
  const hapi = Hapi.server();

  hapi.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  hapi.auth.strategy("bearer-scope", "stub");
  hapi.auth.default("bearer-scope");
  hapi.route(specLinksParseRoute());

  return hapi;
}

const parse = async (payload: Record<string, unknown>) =>
  (await server()).inject({
    method: "POST",
    url: "/api/spec-links/parse",
    payload,
  });

describe("POST /api/spec-links/parse", () => {
  it("answers the test link of specs/a/spec.md with its statement line and target", async () => {
    const res = await parse({
      docs: [
        {
          path: "specs/a/spec.md",
          content:
            "# Spec\n\n- Claims a task. ([validated by claims](apps/x/a.test.ts#L12))\n",
        },
      ],
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      links: [
        {
          doc_path: "specs/a/spec.md",
          statement_line: 3,
          label: "validated by claims",
          path: "apps/x/a.test.ts",
          line: 12,
          misplaced: false,
        },
      ],
    });
  });

  it("answers the links of adrs/ADR-001.md after those of specs/a/spec.md", async () => {
    const res = await parse({
      docs: [
        {
          path: "specs/a/spec.md",
          content: "- One. ([validated by one](apps/x/a.test.ts#L1))",
        },
        {
          path: "adrs/ADR-001.md",
          content: "- Two. ([validated by two](../apps/x/b.test.ts#L2))",
        },
      ],
    });

    expect(JSON.parse(res.payload).links).toMatchObject([
      { doc_path: "specs/a/spec.md", path: "apps/x/a.test.ts" },
      { doc_path: "adrs/ADR-001.md", path: "apps/x/b.test.ts" },
    ]);
  });

  it("answers no links for a doc that carries none", async () => {
    const res = await parse({
      docs: [{ path: "specs/a/spec.md", content: "# Spec\n\nJust prose.\n" }],
    });

    expect(JSON.parse(res.payload)).toEqual({ links: [] });
  });

  it("refuses a body without docs as a 400", async () => {
    const res = await parse({});

    expect(res.statusCode).toBe(400);
  });
});
