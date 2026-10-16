// The Lore traceability ontology Utopia is given: the chain Repository → Document → Section → Statement → Test / Code, kept as turtle beside this module and copied beside dist by the build.

import { readFile } from "node:fs/promises";

/** Bumped when lore-ontology.ttl changes shape; a repo whose settings hold an older number is re-set up. */
export const LORE_ONTOLOGY_VERSION = 3;

export interface LoreKindWord {
  /** The class label, which is the kind word a pushed entity carries. */
  word: string;
  /** Utopia's entity type key: the label in snake_case. */
  classKey: string;
}

/** Every class of the ontology, so a knowledge base can bind each kind word to its class before the first push. */
export const LORE_KIND_WORDS: ReadonlyArray<LoreKindWord> = [
  { word: "Repository", classKey: "repository" },
  { word: "Document", classKey: "document" },
  { word: "Spec", classKey: "spec" },
  { word: "Adr", classKey: "adr" },
  { word: "Section", classKey: "section" },
  { word: "Statement", classKey: "statement" },
  { word: "Test", classKey: "test" },
  { word: "Code", classKey: "code" },
  { word: "SourceFile", classKey: "source_file" },
  { word: "CodeDefinition", classKey: "code_definition" },
];

export function loreOntologyTurtle(): Promise<string> {
  return readFile(new URL("./lore-ontology.ttl", import.meta.url), "utf-8");
}
