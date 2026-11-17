import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "lore-run-blob-home-"));

const { toolHandlers } = await import("../shared/tool-test-helpers.js");
const { fakeLoreApi, specDescription } =
  await import("./shared/fake-lore-api.js");
const { GET_RUN_BLOB_DESCRIPTION, registerGetRunBlobTool } =
  await import("./get-run-blob.js");

const api = fakeLoreApi();
const getBlob = toolHandlers(registerGetRunBlobTool, "agent")[
  "lore_get_run_blob"
];
const HASH = `sha256-${"b".repeat(64)}`;
const textOf = async () =>
  (await getBlob({ run_id: "r1", hash: HASH })).content[0].text;

describe("lore_get_run_blob", () => {
  it("returns the text of blob sha256-bbb… of run r1", async () => {
    api.answer(`/api/assembly-runs/r1/blobs/${HASH}`, {
      hash: HASH,
      text: "hello",
      truncated: false,
    });

    expect(JSON.parse(await textOf())).toEqual({
      hash: HASH,
      text: "hello",
      truncated: false,
    });
  });

  it("serves the blob from the cache on the second read", async () => {
    vi.stubEnv("LORE_CACHE_ENABLED", "true");
    api.answer(`/api/assembly-runs/r1/blobs/${HASH}`, { hash: HASH });
    await textOf();
    await textOf();

    expect(api.requested).toHaveLength(1);
  });

  it("carries the verbatim description block of specs/mcp-tools/get-run-blob/spec.md", () => {
    expect(GET_RUN_BLOB_DESCRIPTION).toBe(specDescription("get-run-blob"));
  });
});
