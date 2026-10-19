import { describe, it, expect } from "vitest";
import {
  ingestedDocMirror,
  type IngestedDocMirrorDeps,
} from "./ingested-doc-mirror.js";
import type { MirroredDoc } from "./utopia-mirror.js";

const COMMIT = "abc123";

function recordingDeps(manifest: string | null): {
  deps: IngestedDocMirrorDeps;
  told: string[];
} {
  const told: string[] = [];

  return {
    told,
    deps: {
      manifest: async (commit) => {
        told.push(`manifest at ${commit}`);

        return manifest;
      },
      mirrorDoc: async (repo, doc: MirroredDoc) => {
        told.push(`mirror ${repo} ${doc.path} ${doc.kind} ${doc.commit}`);
      },
      unmirrorDoc: async (repo, path) => {
        told.push(`tombstone ${repo} ${path}`);
      },
    },
  };
}

describe("ingestedDocMirror", () => {
  it("mirrors README.md as a doc at abc123, tombstones docs/gone.md, reads the manifest once and leaves specs/a/spec.md, ADR-001 and values.yaml to the delta route", async () => {
    const { deps, told } = recordingDeps(null);
    const landed = ingestedDocMirror("o/r", COMMIT, deps);

    await landed.ingested("README.md", "# Lore");
    await landed.ingested("specs/a/spec.md", "# Spec");
    await landed.ingested("adrs/ADR-001-auth.md", "# ADR");
    await landed.ingested("charts/values.yaml", "a: 1");
    await landed.deleted("docs/gone.md");

    expect(told).toEqual([
      "manifest at abc123",
      "mirror o/r README.md doc abc123",
      "tombstone o/r docs/gone.md",
    ]);
  });

  it("leaves docs/specs/mirror.md to the delta route when .lore/ingest.yml declares docs/specs/** as specs", async () => {
    const { deps, told } = recordingDeps("specs:\n  - docs/specs/**\n");
    const landed = ingestedDocMirror("o/r", COMMIT, deps);

    await landed.ingested("docs/specs/mirror.md", "# Mirror");

    expect(told).toEqual(["manifest at abc123"]);
  });

  it("swallows a failed push of CLAUDE.md, so the ingest goes on", async () => {
    const { deps } = recordingDeps(null);
    const landed = ingestedDocMirror("o/r", COMMIT, {
      ...deps,
      mirrorDoc: async () => {
        throw new Error("utopia down");
      },
    });

    await expect(landed.ingested("CLAUDE.md", "# Rules")).resolves.toBe(
      undefined,
    );
  });
});
