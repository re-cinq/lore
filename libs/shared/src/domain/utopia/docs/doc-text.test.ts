import { describe, it, expect } from "vitest";
import { docDocument, docTombstone } from "./doc-text.js";

const base = {
  repo: "re-cinq/lore",
  path: "specs/mirror/spec.md",
  content: "# Mirror\n\n- FR1 — Pushed.\n",
  kind: "spec" as const,
};

describe("docDocument", () => {
  it("leads the whole file with its path, repository and kind and names it doc:specs/mirror/spec.md at the commit time", () => {
    expect(
      docDocument({ ...base, commitTime: "2026-10-15T10:00:00Z" }),
    ).toEqual({
      external_id: "doc:specs/mirror/spec.md",
      filename: "specs/mirror/spec.md",
      content:
        "File: specs/mirror/spec.md\nRepository: re-cinq/lore\nKind: spec\n\n# Mirror\n\n- FR1 — Pushed.\n",
      doc_time: "2026-10-15T10:00:00Z",
    });
  });

  it("carries no doc_time when the commit time is unknown", () => {
    expect(docDocument(base)).not.toHaveProperty("doc_time");
  });

  it("is the same content at two commits, so a later push of an unchanged file is not a new document", () => {
    expect(docDocument(base).content).toEqual(
      docDocument({ ...base, commitTime: "2026-10-16T10:00:00Z" }).content,
    );
  });
});

describe("docTombstone", () => {
  it("is doc:adrs/ADR-1.md deleted, named after its path", () => {
    expect(docTombstone("adrs/ADR-1.md")).toEqual({
      external_id: "doc:adrs/ADR-1.md",
      filename: "adrs/ADR-1.md",
      deleted: true,
    });
  });
});
