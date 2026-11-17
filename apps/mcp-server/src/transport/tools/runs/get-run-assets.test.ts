import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { fakeLoreApi, specDescription } from "./shared/fake-lore-api.js";
import {
  GET_RUN_ASSETS_DESCRIPTION,
  registerGetRunAssetsTool,
} from "./get-run-assets.js";

const api = fakeLoreApi();
const getAssets = toolHandlers(registerGetRunAssetsTool, "agent")[
  "lore_get_run_assets"
];
const textOf = async () => (await getAssets({ run_id: "r1" })).content[0].text;
const HASH = `sha256-${"a".repeat(64)}`;

describe("lore_get_run_assets", () => {
  it("returns the bag, the preview of its blob and the pull files", async () => {
    api.answer("/api/assembly-runs/r1/bag", {
      bag: {
        review: { kind: "file", ref: HASH, by: "post-review" },
        branch: { kind: "git", ref: "lore/x", by: "open-pr" },
      },
    });
    api.answer(`/api/assembly-runs/r1/blob-previews?hash=${HASH}`, {
      previews: { [HASH]: { text: "ok" } },
    });
    api.answer("/api/assembly-runs/r1/pull-files", { files: ["a.ts"] });

    expect(JSON.parse(await textOf())).toEqual({
      bag: {
        review: { kind: "file", ref: HASH, by: "post-review" },
        branch: { kind: "git", ref: "lore/x", by: "open-pr" },
      },
      previews: { [HASH]: { text: "ok" } },
      pull_files: { files: ["a.ts"] },
    });
  });

  it("asks for no previews when the bag holds no blob", async () => {
    api.answer("/api/assembly-runs/r1/bag", { bag: {} });

    expect(JSON.parse(await textOf())).toMatchObject({ bag: {}, previews: {} });
    expect(api.requested).not.toContain(
      expect.stringContaining("blob-previews"),
    );
  });

  it("keeps failed previews as {error: 'HTTP 404 Not Found'}", async () => {
    api.answer("/api/assembly-runs/r1/bag", {
      bag: { review: { kind: "file", ref: HASH, by: "x" } },
    });

    expect(JSON.parse(await textOf())).toMatchObject({
      previews: { error: "HTTP 404 Not Found" },
    });
  });

  it("fails when the run has no bag", async () => {
    expect(await textOf()).toContain("HTTP 404 Not Found");
  });

  it("carries the verbatim description block of specs/mcp-tools/get-run-assets/spec.md", () => {
    expect(GET_RUN_ASSETS_DESCRIPTION).toBe(specDescription("get-run-assets"));
  });
});
