import { describe, expect, it } from "vitest";
import { descriptorsFromVitestList } from "../spec-trace/trace-descriptors.js";
import type { DefinitionOfDone } from "./dod-markdown.js";
import { dodProgress, matchAcceptanceTests } from "./dod-match.js";

const tests = descriptorsFromVitestList(
  [
    {
      name: "archive > hides an archived note",
      file: "/w/app/src/notes.test.ts",
    },
    { name: "archive > keeps it readable", file: "/w/app/src/notes.test.ts" },
    { name: "Reads By Id", file: "/w/app/src/read.test.ts" },
  ],
  { pkg: "app" },
);

const report = {
  tests,
  outcomes: {
    "app/src/notes.test.ts::archive > hides an archived note": true,
    "app/src/notes.test.ts::archive > keeps it readable": false,
  },
};

function dod(
  acceptanceTests: Array<{ path: string; name: string }>,
): DefinitionOfDone {
  return {
    ticketClaim: "",
    strategy: "direct",
    why: "",
    acceptanceTests: acceptanceTests.map((t) => ({
      ...t,
      behaviour: "b",
      done: false,
    })),
    facets: [],
    outOfScope: [],
  };
}

describe("matchAcceptanceTests", () => {
  it("matches by leaf title within the same file and reports pass or fail from the outcomes", () => {
    const statuses = matchAcceptanceTests(
      dod([
        { path: "./app/src/notes.test.ts", name: "hides an archived note" },
        { path: "/app/src/notes.test.ts", name: "keeps it readable" },
      ]),
      report,
    );

    expect(statuses).toEqual([
      {
        path: "./app/src/notes.test.ts",
        name: "hides an archived note",
        behaviour: "b",
        status: "pass",
        matchedId: "app/src/notes.test.ts::archive > hides an archived note",
      },
      {
        path: "/app/src/notes.test.ts",
        name: "keeps it readable",
        behaviour: "b",
        status: "fail",
        matchedId: "app/src/notes.test.ts::archive > keeps it readable",
      },
    ]);
  });

  it("matches a case- and whitespace-insensitive leaf when the file path is a suffix", () => {
    expect(
      matchAcceptanceTests(
        dod([{ path: "src/read.test.ts", name: "reads   by id" }]),
        report,
      ),
    ).toMatchObject([
      { status: "unknown", matchedId: "app/src/read.test.ts::Reads By Id" },
    ]);
  });

  it("reports unknown for a test no descriptor in that file matches", () => {
    expect(
      matchAcceptanceTests(
        dod([{ path: "app/src/notes.test.ts", name: "nope" }]),
        report,
      ),
    ).toMatchObject([{ status: "unknown", matchedId: null }]);
  });

  it("reports unknown for every test when CI has posted no report", () => {
    expect(
      matchAcceptanceTests(
        dod([
          { path: "app/src/notes.test.ts", name: "hides an archived note" },
        ]),
        null,
      ),
    ).toMatchObject([{ status: "unknown", matchedId: null }]);
  });
});

describe("dodProgress", () => {
  it("counts passes over the total", () => {
    const statuses = matchAcceptanceTests(
      dod([
        { path: "app/src/notes.test.ts", name: "hides an archived note" },
        { path: "app/src/notes.test.ts", name: "keeps it readable" },
        { path: "app/src/notes.test.ts", name: "missing" },
      ]),
      report,
    );

    expect(dodProgress(statuses)).toEqual({ passed: 1, total: 3 });
  });
});
