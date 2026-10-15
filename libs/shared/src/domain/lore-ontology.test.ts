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

  it("reads the turtle file beside the module, which declares every kind word as a class at version 2", async () => {
    const turtle = await loreOntologyTurtle();
    const declared = LORE_KIND_WORDS.map(({ word }) =>
      turtle.includes(`lore:${word} a owl:Class`),
    );

    expect({ version: LORE_ONTOLOGY_VERSION, declared }).toEqual({
      version: 2,
      declared: LORE_KIND_WORDS.map(() => true),
    });
  });

  it("declares text on Section and Statement and title on Document, both strings, so a pushed statement's words and a document's title are attributes the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const declaration = (property: string) =>
      new RegExp(
        String.raw`lore:${property} a owl:DatatypeProperty ;[\s\S]*?rdfs:domain ([^;]*);\s*rdfs:range xsd:string \.`,
      ).exec(turtle)?.[1];

    expect({
      text: declaration("text")?.trim(),
      title: declaration("title")?.trim(),
    }).toEqual({
      text: "lore:Section, lore:Statement",
      title: "lore:Document, lore:Test, lore:Section",
    });
  });
});
