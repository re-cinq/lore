import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDistArtifact } from "./dist.js";
import { buildServer } from "../../../server/build-server.js";
import { useRateLimitSafeClock } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

describe("parseDistArtifact", () => {
  it("returns the artifact name for an allowed os-arch", () => {
    expect(parseDistArtifact("/dist/lore-code-trace/linux-amd64")).toBe("linux-amd64");
  });

  it("strips a query string", () => {
    expect(parseDistArtifact("/dist/lore-code-trace/linux-arm64?v=1")).toBe("linux-arm64");
  });

  it("allows checksums.txt", () => {
    expect(parseDistArtifact("/dist/lore-code-trace/checksums.txt")).toBe("checksums.txt");
  });

  it("rejects path traversal", () => {
    expect(parseDistArtifact("/dist/lore-code-trace/../../etc/passwd")).toBeNull();
  });

  it("rejects an unknown artifact", () => {
    expect(parseDistArtifact("/dist/lore-code-trace/windows-386")).toBeNull();
  });

  it("returns null for a non-dist url", () => {
    expect(parseDistArtifact("/api/whatever")).toBeNull();
  });
});

describe("GET /dist/lore-code-trace", () => {
  useRateLimitSafeClock();
  let dir: string | undefined;
  const inject = (url: string) => buildServer(() => null).inject({ method: "GET", url });

  afterEach(async () => {
    delete process.env.LORE_DIST_DIR;

    if (dir) {await rm(dir, { recursive: true, force: true });}
    dir = undefined;
  });

  it("serves a present binary as octet-stream with its byte length", async () => {
    dir = await mkdtemp(join(tmpdir(), "lore-dist-"));
    await writeFile(join(dir, "linux-amd64"), Buffer.from("BINARY"));
    process.env.LORE_DIST_DIR = dir;

    const res = await inject("/dist/lore-code-trace/linux-amd64");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-length"]).toBe(6);
  });

  it("404s when the artifact is not baked into the image", async () => {
    dir = await mkdtemp(join(tmpdir(), "lore-dist-"));
    process.env.LORE_DIST_DIR = dir;

    const res = await inject("/dist/lore-code-trace/linux-amd64");

    expect(res.statusCode).toBe(404);
  });

  it("404s an unknown artifact name without touching the filesystem", async () => {
    const res = await inject("/dist/lore-code-trace/windows-386");

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "unknown artifact" });
  });
});
