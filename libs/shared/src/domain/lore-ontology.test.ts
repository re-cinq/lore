import { describe, it, expect } from "vitest";
import {
  LORE_KIND_WORDS,
  LORE_ONTOLOGY_VERSION,
  loreOntologyTurtle,
} from "./lore-ontology.js";

describe("lore ontology", () => {
  it("binds the eighteen class labels of the chain and its history to their snake_case class keys", () => {
    const snakeCase = (word: string) =>
      word.replace(/(?<=[a-z])([A-Z])/g, "_$1").toLowerCase();

    expect(LORE_KIND_WORDS).toEqual(
      [
        "Repository",
        "Document",
        "Spec",
        "Adr",
        "Doc",
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
        "Person",
      ].map((word) => ({ word, classKey: snakeCase(word) })),
    );
  });

  it("reads the turtle file beside the module, which declares every kind word as a class at version 10", async () => {
    const turtle = await loreOntologyTurtle();
    const declared = LORE_KIND_WORDS.map(({ word }) =>
      turtle.includes(`lore:${word} a owl:Class`),
    );

    expect({ version: LORE_ONTOLOGY_VERSION, declared }).toEqual({
      version: 10,
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
        "lore:Repository, lore:Document, lore:Section, lore:SourceFile, lore:CodeDefinition",
        "lore:Document, lore:SourceFile, lore:Section, lore:Statement, lore:Test, lore:Commit, lore:PullRequest, lore:Issue, lore:Task, lore:Release, lore:Tag, lore:CodeDefinition",
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
      declared: 20,
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
        extends: "eternal",
        implements: "eternal",
        changes: "event",
        follows: "event",
        merges: "event",
        closes: "event",
        refers_to: "event",
        delivers: "event",
        points_to: "eternal",
        publishes: "eternal",
        authored_by: "event",
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

  it("declares every pair of Lore's leaf classes disjoint, so Utopia never proposes a Spec and its Statement as one entity", async () => {
    const turtle = await loreOntologyTurtle();
    const blocks = [
      ...turtle.matchAll(/lore:(\w+) a owl:Class ;([\s\S]*?) \.\n/g),
    ];
    const objectsOf = (body: string, predicate: string) =>
      [...body.matchAll(new RegExp(String.raw`${predicate} ([^;]*)`, "g"))]
        .flatMap(([, objects]) => objects.split(","))
        .map((object) => object.trim().replace("lore:", ""));
    const parentOf = new Map(
      blocks.flatMap(([, name, body]) =>
        objectsOf(body, "rdfs:subClassOf").map((parent) => [name, parent]),
      ),
    );
    const declared = new Set(
      blocks.flatMap(([, name, body]) =>
        objectsOf(body, "owl:disjointWith").flatMap((other) => [
          `${name}|${other}`,
          `${other}|${name}`,
        ]),
      ),
    );
    const selfAndAncestors = (name: string): string[] => {
      const parent = parentOf.get(name);

      return parent ? [name, ...selfAndAncestors(parent)] : [name];
    };
    const pairsOf = (classes: string[]) =>
      classes.flatMap((a, index) =>
        classes.slice(index + 1).map((b) => `${a}|${b}`),
      );
    const leaves = blocks
      .map(([, name]) => name)
      .filter((name) => ![...parentOf.values()].includes(name));
    const disjoint = pairsOf(leaves).filter((pair) => {
      const [a, b] = pair.split("|");

      return selfAndAncestors(a).some((left) =>
        selfAndAncestors(b).some((right) => declared.has(`${left}|${right}`)),
      );
    });

    expect(disjoint).toEqual(
      pairsOf([
        "Repository",
        "Spec",
        "Adr",
        "Doc",
        "Section",
        "Statement",
        "Test",
        "SourceFile",
        "CodeDefinition",
        "Commit",
        "PullRequest",
        "Issue",
        "Task",
        "Release",
        "Tag",
        "Person",
      ]),
    );
  });

  it("declares authored_by from Commit, PullRequest and Issue to Person, so who wrote a commit or opened a pull request is a term the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const declaration =
      /lore:authored_by a owl:ObjectProperty ;[\s\S]*?rdfs:domain ([^;]*);\s*rdfs:range ([^.]*) \./
        .exec(turtle)
        ?.slice(1)
        .map((part) => part.trim());

    expect(declaration).toEqual([
      "lore:Commit, lore:PullRequest, lore:Issue",
      "lore:Person",
    ]);
  });
  it("declares kind and exported on CodeDefinition, extends and implements between definitions, contains from a class to its methods and anchor_hash on CodeDefinition, so a file's structure is terms the base knows", async () => {
    const turtle = await loreOntologyTurtle();
    const lines = [
      'lore:kind a owl:DatatypeProperty ;\n  rdfs:label "kind" ;',
      "rdfs:domain lore:CodeDefinition ;\n  rdfs:range xsd:string .",
      'lore:exported a owl:DatatypeProperty ;\n  rdfs:label "exported" ;',
      "rdfs:domain lore:CodeDefinition ;\n  rdfs:range xsd:boolean .",
      'lore:extends a owl:ObjectProperty ;\n  rdfs:label "extends" ;',
      'lore:implements a owl:ObjectProperty ;\n  rdfs:label "implements" ;',
      "rdfs:domain lore:CodeDefinition ;\n  rdfs:range lore:CodeDefinition .",
      "rdfs:domain lore:Test, lore:CodeDefinition ;\n  rdfs:range xsd:string .",
      "rdfs:domain lore:Section, lore:Statement ;\n  rdfs:range lore:Code, lore:CodeDefinition .",
    ];

    expect(lines.map((line) => turtle.includes(line))).toEqual(
      lines.map(() => true),
    );
  });

  it("annotates how each kind is shown: a status with its tones, a title, a quote, a span, a link, a key, children relations and the chain from a statement, so a base draws the chain without knowing the words", async () => {
    const turtle = await loreOntologyTurtle();
    const annotations = [
      'lore:Statement a owl:Class ;\n  rdfs:label "Statement" ;\n  utopia:panel "quote" ;\n  utopia:chain_first "out:validated_by" ;',
      'lore:Test a owl:Class ;\n  rdfs:label "Test" ;\n  utopia:panel "card" ;',
      'lore:SourceFile a owl:Class ;\n  rdfs:label "SourceFile" ;\n  utopia:panel "tree" ;',
      'lore:CodeDefinition a owl:Class ;\n  rdfs:label "CodeDefinition" ;\n  utopia:panel "card" ;',
      'rdfs:label "outcome" ;\n  utopia:role "status" ;\n  utopia:tones "passed=ok,failed=danger" ;',
      'rdfs:label "title" ;\n  utopia:role "title" ;',
      'rdfs:label "text" ;\n  utopia:role "quote" ;',
      'rdfs:label "line_start" ;\n  utopia:role "span_start" ;',
      'rdfs:label "line_end" ;\n  utopia:role "span_end" ;',
      'rdfs:label "permalink" ;\n  utopia:role "link" ;',
      'rdfs:label "anchor_hash" ;\n  utopia:role "key" ;',
      'rdfs:label "ranges" ;\n  utopia:role "range" ;',
      'rdfs:label "contains" ;\n  utopia:role "children" ;',
      'rdfs:label "defines" ;\n  utopia:role "children" ;',
      'rdfs:label "validated_by" ;\n  utopia:chain_next "out:covers" ;',
      'rdfs:label "covers" ;\n  utopia:chain_next "in:changes" ;',
    ];

    expect(annotations.map((line) => turtle.includes(line))).toEqual(
      annotations.map(() => true),
    );
  });
});
