import { describe, it, expect } from "vitest";
import {
  LORE_KIND_WORDS,
  LORE_ONTOLOGY_VERSION,
  loreOntologyTurtle,
} from "./lore-ontology.js";

describe("lore ontology", () => {
  it("binds the ten class labels of the chain to their snake_case class keys", () => {
    const snakeCase = (word: string) =>
      word.replace(/(?<=[a-z])([A-Z])/g, "_$1").toLowerCase();

    expect(LORE_KIND_WORDS).toEqual(
      [
        "Repository",
        "Document",
        "Spec",
        "Adr",
        "Section",
        "Statement",
        "Test",
        "Code",
        "SourceFile",
        "CodeDefinition",
      ].map((word) => ({ word, classKey: snakeCase(word) })),
    );
  });

  it("reads the turtle file beside the module, which declares every kind word as a class at version 1", async () => {
    const turtle = await loreOntologyTurtle();
    const declared = LORE_KIND_WORDS.map(({ word }) =>
      turtle.includes(`lore:${word} a owl:Class`),
    );

    expect({ version: LORE_ONTOLOGY_VERSION, declared }).toEqual({
      version: 1,
      declared: LORE_KIND_WORDS.map(() => true),
    });
  });
});
