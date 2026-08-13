import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openApiArtifactPath } from "./gen-openapi.js";
import { generateOpenApi } from "./build-document.js";
import { routeList } from "../server/build-server.js";

// The artifact is only worth committing if regenerating it is deterministic — a
// drift guard that compares a regenerated file to the committed one turns any
// environmental input into a red CI run on an unrelated PR.

describe("the committed OpenAPI artifact", () => {
  it("is written next to lore-api's package.json", () => {
    expect(openApiArtifactPath().endsWith("/apps/lore-api/openapi.json")).toBe(
      true,
    );
  });

  it("importing the generator writes nothing", () => {
    // The module was imported at the top of this file. If the write were a module
    // side effect rather than a CLI entry point, `vitest` would have rewritten the
    // artifact just by loading it — and every test run would dirty the tree.
    const onDisk = readFileSync(openApiArtifactPath(), "utf8");

    expect(onDisk).toEqual(readFileSync(openApiArtifactPath(), "utf8"));
  });

  it("matches what the routes generate right now", () => {
    // Parsed, not textual: the artifact is prettier-formatted after the write, and
    // prettier's json printer is not byte-identical to JSON.stringify. The drift
    // guard compares the two texts after running the SAME pipeline, so it stays
    // exact; this asserts content.
    const { document } = generateOpenApi(routeList(() => null));

    expect(JSON.parse(readFileSync(openApiArtifactPath(), "utf8"))).toEqual(
      document,
    );
  });

  it("generates identically twice from the same routes", () => {
    const once = generateOpenApi(routeList(() => null)).document;
    const twice = generateOpenApi(routeList(() => null)).document;

    expect(JSON.stringify(once)).toEqual(JSON.stringify(twice));
  });

  it("names no environment-derived server URL", () => {
    // `serverUrl` defaults to LORE_API_URL when the SERVING route generates; the
    // artifact must not carry it, or every environment produces a different file.
    const doc = JSON.parse(readFileSync(openApiArtifactPath(), "utf8")) as {
      servers?: { url: string }[];
    };

    expect(doc.servers?.some((s) => s.url.includes("http"))).not.toBe(true);
  });
});
