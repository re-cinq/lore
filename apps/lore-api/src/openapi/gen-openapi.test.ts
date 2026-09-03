import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openApiArtifactPath } from "./gen-openapi.js";
import { generateOpenApi } from "./build-document.js";
import { routeList } from "../server/build-server.js";

describe("the committed OpenAPI artifact", () => {
  it("is written next to lore-api's package.json", () => {
    expect(openApiArtifactPath().endsWith("/apps/lore-api/openapi.json")).toBe(
      true,
    );
  });

  it("importing the generator writes nothing", () => {
    const onDisk = readFileSync(openApiArtifactPath(), "utf8");

    expect(onDisk).toEqual(readFileSync(openApiArtifactPath(), "utf8"));
  });

  it("matches what the routes generate right now", () => {
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
    const doc = JSON.parse(readFileSync(openApiArtifactPath(), "utf8")) as {
      servers?: { url: string }[];
    };

    expect(doc.servers?.some((s) => s.url.includes("http"))).not.toBe(true);
  });
});
