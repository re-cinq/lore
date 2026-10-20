import type { DocKind } from "@/lib/spec-status";

export interface DocCardLabel {
  /** `ADR-048` for a numbered decision record; absent otherwise. */
  number?: string;
  title: string;
}

const ADR_NAME = /^ADR[-_]?(\d+)[-_]?(.*)$/i;

/** A readable name for a doc the graph only knows by path: the ADR number and slug, or the spec's folder. */
export function docCardLabel(kind: DocKind, filePath: string): DocCardLabel {
  const parts = filePath.split("/");
  const stem = (parts.at(-1) ?? filePath).replace(/\.md$/i, "");
  const adr = kind === "adr" ? ADR_NAME.exec(stem) : null;

  if (adr) {
    return { number: `ADR-${adr[1]}`, title: humanize(adr[2] || stem) };
  }

  return { title: humanize(specName(stem, parts.at(-2))) };
}

/** A `spec.md` is named by its folder, any other file by its own name; a leading `7-` ordinal is dropped. */
function specName(stem: string, folder: string | undefined): string {
  const name = stem.toLowerCase() === "spec" && folder ? folder : stem;

  return name.replace(/^\d+[-_]/, "");
}

/** `one-websocket_for-live` → `One websocket for live`. */
function humanize(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
