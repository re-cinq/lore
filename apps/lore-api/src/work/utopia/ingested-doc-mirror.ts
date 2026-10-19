// The file ingest's side of the Utopia mirror: a markdown document `POST /api/ingest` stores (README.md, CLAUDE.md, docs/**, runbooks/**, teams/**) is pushed whole, and one it deletes is tombstoned. Specs and ADRs are left to the delta route, which mirrors them already.

import type { LandedFiles } from "../spec-trace/ingest.js";
import { projectFor } from "../../outbound/project-boot.js";
import { docsToMirror, INGEST_MANIFEST_PATH } from "./ingested-docs.js";
import { mirrorQuietly } from "./mirror-quietly.js";
import {
  mirrorDocFor,
  unmirrorDocFor,
  type MirroredDoc,
} from "./utopia-mirror.js";

export interface IngestedDocMirrorDeps {
  manifest(commit: string): Promise<string | null>;
  mirrorDoc(repo: string, doc: MirroredDoc): Promise<void>;
  unmirrorDoc(repo: string, path: string): Promise<void>;
}

export function ingestedDocMirror(
  repo: string,
  commit: string,
  deps: IngestedDocMirrorDeps = repoDocMirrorDeps(repo),
): LandedFiles {
  const whenDoc = docGate(repo, () => deps.manifest(commit));

  return {
    ingested: (path, content) =>
      whenDoc(path, () =>
        deps.mirrorDoc(repo, { path, content, kind: "doc", commit }),
      ),
    deleted: (path) => whenDoc(path, () => deps.unmirrorDoc(repo, path)),
  };
}

/** Runs a mirror for a path that is a doc, quietly; the manifest is read once, and only for a markdown path. */
function docGate(
  repo: string,
  readManifest: () => Promise<string | null>,
): (path: string, mirror: () => Promise<void>) => Promise<void> {
  let manifest: Promise<string | null> | null = null;
  const isDoc = async (path: string) =>
    docsToMirror([path], await (manifest ??= readManifest())).some(
      (doc) => doc.kind === "doc",
    );

  return async (path, mirror) => {
    if (path.endsWith(".md")) {
      await mirrorQuietly(repo, path, async () =>
        (await isDoc(path)) ? mirror() : undefined,
      );
    }
  };
}

function repoDocMirrorDeps(repo: string): IngestedDocMirrorDeps {
  return {
    manifest: async (commit) =>
      (await projectFor(repo)).repo.read(INGEST_MANIFEST_PATH, commit),
    mirrorDoc: mirrorDocFor,
    unmirrorDoc: unmirrorDocFor,
  };
}
