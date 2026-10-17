import { describe, it, expect } from "vitest";
import {
  LORE_KIND_WORDS,
  LORE_ONTOLOGY_VERSION,
  loreOntologyTurtle,
} from "./lore-ontology.js";

describe("lore ontology", () => {
  it("binds the sixteen class labels of the chain and its history to their snake_case class keys", () => {
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
        "Commit",
        "PullRequest",
        "Issue",
        "Task",
        "Release",
        "Tag",
      ].map((word) => ({ word, classKey: snakeCase(word) })),
    );
  });

  it("reads the turtle file beside the module, which declares every kind word as a class at version 5", async () => {
    const turtle = await loreOntologyTurtle();
    const declared = LORE_KIND_WORDS.map(({ word }) =>
      turtle.includes(`lore:${word} a owl:Class`),
    );

    expect({ version: LORE_ONTOLOGY_VERSION, declared }).toEqual({
      version: 5,
      declared: LORE_KIND_WORDS.map(() => true),
    });
  });

  it("declares text on Section, Statement, Commit, PullRequest, Issue and Release and title on Document, Commit, PullRequest, Issue and Release, both strings, so a pushed statement's words, a pull request's body and a document's title are attributes the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const declaration = (property: string) =>
      new RegExp(
        String.raw`lore:${property} a owl:DatatypeProperty ;[\s\S]*?rdfs:domain ([^;]*);\s*rdfs:range xsd:string \.`,
      ).exec(turtle)?.[1];

    expect({
      text: declaration("text")?.trim(),
      title: declaration("title")?.trim(),
    }).toEqual({
      text: "lore:Section, lore:Statement, lore:Commit, lore:PullRequest, lore:Issue, lore:Release",
      title:
        "lore:Document, lore:Test, lore:Section, lore:Commit, lore:PullRequest, lore:Issue, lore:Release",
    });
  });

  it("declares violated_by from Statement to Test, outcome as a string on Test, Test under commit, and SourceFile containing Test, so a test run's statements are terms the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const declaration = (property: string) =>
      new RegExp(
        String.raw`lore:${property} a owl:\w+ ;[\s\S]*?rdfs:domain ([^;]*);\s*rdfs:range ([^.]*) \.`,
      )
        .exec(turtle)
        ?.slice(1)
        .map((part) => part.trim());

    expect({
      violatedBy: declaration("violated_by"),
      outcome: declaration("outcome"),
      commit: declaration("commit"),
      contains: declaration("contains"),
    }).toEqual({
      violatedBy: ["lore:Statement", "lore:Test"],
      outcome: ["lore:Test", "xsd:string"],
      commit: ["lore:Document, lore:SourceFile, lore:Test", "xsd:string"],
      contains: [
        "lore:Repository, lore:Document, lore:Section, lore:SourceFile",
        "lore:Document, lore:SourceFile, lore:Section, lore:Statement, lore:Test, lore:Commit, lore:PullRequest, lore:Issue, lore:Task, lore:Release, lore:Tag",
      ],
    });
  });

  it("declares changes from Commit to Code and Document, follows between Commits, merges to PullRequest, closes and refers_to to Issue and delivers to Task, so a commit's history is terms the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const declaration = (property: string) =>
      new RegExp(
        String.raw`lore:${property} a owl:ObjectProperty ;[\s\S]*?rdfs:domain ([^;]*);\s*rdfs:range ([^.]*) \.`,
      )
        .exec(turtle)
        ?.slice(1)
        .map((part) => part.trim());

    expect({
      changes: declaration("changes"),
      follows: declaration("follows"),
      merges: declaration("merges"),
      closes: declaration("closes"),
      refersTo: declaration("refers_to"),
      delivers: declaration("delivers"),
    }).toEqual({
      changes: ["lore:Commit", "lore:Code, lore:Document"],
      follows: ["lore:Commit", "lore:Commit"],
      merges: ["lore:Commit", "lore:PullRequest"],
      closes: ["lore:PullRequest", "lore:Issue"],
      refersTo: ["lore:PullRequest", "lore:Issue"],
      delivers: ["lore:PullRequest", "lore:Task"],
    });
  });

  it("marks every object property with utopia:temporal, the commit relations as event and the structural ones as eternal, so Utopia binds a pushed phrase by the declaration instead of asking a model", async () => {
    const turtle = await loreOntologyTurtle();
    const temporalOf = [
      ...turtle.matchAll(
        /lore:(\w+) a owl:ObjectProperty ;[\s\S]*?utopia:temporal "(\w+)"/g,
      ),
    ].map(([, property, temporal]) => [property, temporal]);
    const declared = [...turtle.matchAll(/lore:(\w+) a owl:ObjectProperty/g)]
      .length;

    expect({ declared, temporalOf: Object.fromEntries(temporalOf) }).toEqual({
      declared: 17,
      temporalOf: {
        contains: "eternal",
        validated_by: "eternal",
        violated_by: "eternal",
        implemented_by: "eternal",
        decided_by: "eternal",
        covers: "eternal",
        defines: "eternal",
        references: "eternal",
        imports: "eternal",
        changes: "event",
        follows: "event",
        merges: "event",
        closes: "event",
        refers_to: "event",
        delivers: "event",
        points_to: "eternal",
        publishes: "eternal",
      },
    });
  });

  it("declares points_to from Tag to Commit, publishes from Release to Tag, and the tracker attributes state, labels, opened_at, closed_at, merged_at, published_at and tag, so a pull request, an issue and a release are terms the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const declaration = (property: string) =>
      new RegExp(
        String.raw`lore:${property} a owl:\w+ ;[\s\S]*?rdfs:domain ([^;]*);\s*rdfs:range ([^.]*) \.`,
      )
        .exec(turtle)
        ?.slice(1)
        .map((part) => part.trim());

    expect({
      pointsTo: declaration("points_to"),
      publishes: declaration("publishes"),
      author: declaration("author"),
      state: declaration("state"),
      labels: declaration("labels"),
      openedAt: declaration("opened_at"),
      closedAt: declaration("closed_at"),
      mergedAt: declaration("merged_at"),
      publishedAt: declaration("published_at"),
      tag: declaration("tag"),
      permalink: declaration("permalink"),
    }).toEqual({
      pointsTo: ["lore:Tag", "lore:Commit"],
      publishes: ["lore:Release", "lore:Tag"],
      author: [
        "lore:Commit, lore:PullRequest, lore:Issue, lore:Release",
        "xsd:string",
      ],
      state: ["lore:PullRequest, lore:Issue", "xsd:string"],
      labels: ["lore:PullRequest, lore:Issue", "xsd:string"],
      openedAt: ["lore:PullRequest, lore:Issue", "xsd:dateTime"],
      closedAt: ["lore:PullRequest, lore:Issue", "xsd:dateTime"],
      mergedAt: ["lore:PullRequest", "xsd:dateTime"],
      publishedAt: ["lore:Release", "xsd:dateTime"],
      tag: ["lore:Release, lore:Tag", "xsd:string"],
      permalink: [
        "lore:Document, lore:Section, lore:Statement, lore:Test, lore:Code, lore:Commit, lore:PullRequest, lore:Issue, lore:Release, lore:Tag",
        "xsd:anyURI",
      ],
    });
  });
});
