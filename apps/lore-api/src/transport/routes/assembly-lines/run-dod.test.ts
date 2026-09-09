import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { InMemoryTestReports } from "@re-cinq/lore-shared/project/test-reports/test-reports-memory.js";
import { runDodRoute, type ReadRepoFile } from "./run-dod.js";

const DOD = `# Definition of Done

> Users can archive a note.

**Strategy: \`direct\`** — one flag.

## Done when these pass

- [ ] **hides an archived note** — gone from the list
  \`src/notes.test.ts\`
- [ ] **keeps it readable** — a direct read still resolves
  \`src/notes.test.ts\`

## Facets

- [x] red: archive test

## Out of scope

- bulk archive
`;

interface Fixture {
  runs?: InMemoryAssemblyRuns;
  testReports?: InMemoryTestReports;
  files?: Record<string, string>;
}

function serve(fixture: Fixture) {
  const server = Hapi.server();
  const reads: string[] = [];
  const readFile: ReadRepoFile = async (repo, path, ref) => {
    reads.push(`${repo}:${ref}:${path}`);

    return fixture.files?.[ref] ?? null;
  };

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    runDodRoute(() => null, {
      runs: fixture.runs ?? new InMemoryAssemblyRuns(),
      testReports: fixture.testReports ?? new InMemoryTestReports(),
      readFile,
    }),
  );

  return { server, reads };
}

async function startRun(runs: InMemoryAssemblyRuns, branch: string | null) {
  return runs.start({
    blueprintName: "implementation-loop",
    repo: "o/r",
    ...(branch ? { branch } : {}),
  });
}

describe("GET /api/assembly-runs/{id}/dod", () => {
  it("returns 404 for a run that does not exist", async () => {
    const { server } = serve({});
    const res = await server.inject("/api/assembly-runs/nope/dod");

    expect(res.statusCode).toBe(404);
  });

  it("answers present false for a finished run without reading the branch", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await startRun(runs, "lore/ticket-7");

    await runs.finish(id, "success");
    const { server, reads } = serve({
      runs,
      files: { "lore/ticket-7": DOD },
    });
    const res = await server.inject(`/api/assembly-runs/${id}/dod`);

    expect(res.result).toEqual({ present: false });
    expect(reads).toEqual([]);
  });

  it("answers present false when the branch carries no .lore/dod.md", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await startRun(runs, "lore/ticket-7");
    const { server, reads } = serve({ runs });
    const res = await server.inject(`/api/assembly-runs/${id}/dod`);

    expect(res.result).toEqual({ present: false });
    expect(reads).toEqual(["o/r:lore/ticket-7:.lore/dod.md"]);
  });

  it("answers present false when the file is not a definition of done", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await startRun(runs, "lore/ticket-7");
    const { server } = serve({
      runs,
      files: { "lore/ticket-7": "# Notes\n\nnothing here\n" },
    });
    const res = await server.inject(`/api/assembly-runs/${id}/dod`);

    expect(res.result).toEqual({ present: false });
  });

  it("answers present false for a run with no branch", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await startRun(runs, null);
    const { server, reads } = serve({ runs, files: {} });
    const res = await server.inject(`/api/assembly-runs/${id}/dod`);

    expect(res.result).toEqual({ present: false });
    expect(reads).toEqual([]);
  });

  it("matches the acceptance tests against the branch's latest CI report and counts progress", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await startRun(runs, "lore/ticket-7");
    const testReports = new InMemoryTestReports({
      now: () => new Date("2026-09-09T10:00:00Z"),
    });

    await testReports.upsertLatest({
      repo: "o/r",
      commit: "abc123",
      branch: "lore/ticket-7",
      tests: [
        {
          id: "src/notes.test.ts::archive > hides an archived note",
          name: "archive > hides an archived note",
          file: "src/notes.test.ts",
        },
      ],
      outcomes: { "src/notes.test.ts::archive > hides an archived note": true },
    });
    const { server } = serve({
      runs,
      testReports,
      files: { "lore/ticket-7": DOD },
    });
    const res = await server.inject(`/api/assembly-runs/${id}/dod`);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      present: true,
      ticketClaim: "Users can archive a note.",
      strategy: "direct",
      why: "one flag.",
      acceptanceTests: [
        {
          path: "src/notes.test.ts",
          name: "hides an archived note",
          behaviour: "gone from the list",
          status: "pass",
          matchedId: "src/notes.test.ts::archive > hides an archived note",
        },
        {
          path: "src/notes.test.ts",
          name: "keeps it readable",
          behaviour: "a direct read still resolves",
          status: "unknown",
          matchedId: null,
        },
      ],
      facets: [{ text: "red: archive test", done: true }],
      outOfScope: ["bulk archive"],
      passed: 1,
      total: 2,
      report: {
        commit: "abc123",
        branch: "lore/ticket-7",
        receivedAt: "2026-09-09T10:00:00.000Z",
      },
    });
  });

  it("reports every acceptance test unknown and no report when CI has posted nothing", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await startRun(runs, "lore/ticket-7");
    const { server } = serve({ runs, files: { "lore/ticket-7": DOD } });
    const res = await server.inject(`/api/assembly-runs/${id}/dod`);

    expect(JSON.parse(res.payload)).toMatchObject({
      present: true,
      acceptanceTests: [{ status: "unknown" }, { status: "unknown" }],
      passed: 0,
      total: 2,
      report: null,
    });
  });
});
