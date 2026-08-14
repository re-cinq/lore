import { describe, it, expect } from "vitest";
import { dispatchSpecTrace } from "./spec-trace-dispatch.js";

/**
 * dispatchSpecTrace routes a spec-trace trigger by kind onto the ingest
 * assembly line (FR6: the Floor never projects inline — every dgraph write
 * happens in an ingest-station pod). The repo is only ever read to self-chunk
 * a force-without-glob pass into per-directory child events.
 */
function fakeProjectFor() {
  const reposAskedFor: string[] = [];
  const projectFor = async (repo: string) => {
    reposAskedFor.push(repo);

    return { repo: { tree: async () => [] as string[], read: async () => "" } };
  };

  return { projectFor, reposAskedFor };
}

const startLineRecorder = () => {
  const started: Array<Record<string, unknown>> = [];

  return {
    started,
    startLine: async (input: unknown) => {
      started.push(input as Record<string, unknown>);

      return "a1b2c3d4-0000-0000-0000-000000000000";
    },
  };
};

describe("dispatchSpecTrace", () => {
  it("routes a docs kind to the ingest line instead of projecting inline", async () => {
    const { started, startLine } = startLineRecorder();
    const projectFor = async (_repo: string) => ({
      repo: {
        tree: async (): Promise<string[]> => {
          throw new Error("line routing must not read the repo");
        },
        read: async () => "",
      },
    });
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123" },
      { projectFor, startLine },
    );

    // branch is the overlap-guard lease key — per kind, so the specs and adrs
    // lines of one push never collide; the clone ref rides args.ref.
    expect(started).toEqual([
      {
        blueprintName: "ingest",
        repo: "re-cinq/lore",
        branch: "ingest/specs/abc123",
        args: { kind: "specs", ref: "abc123" },
      },
    ]);
    expect(result.logLine).toContain("ingest line a1b2c3d4");
  });

  it("threads glob and force into the line args as strings", async () => {
    const { started, startLine } = startLineRecorder();
    const f = fakeProjectFor();

    await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true, glob: "specs/auth/" },
      { projectFor: f.projectFor, startLine },
    );

    expect(started[0]).toMatchObject({
      args: {
        kind: "specs",
        ref: "abc123",
        glob: "specs/auth/",
        force: "true",
      },
    });
  });

  it("a docs kind without a line starter is a config error, not a silent inline projection", async () => {
    const f = fakeProjectFor();

    await expect(
      dispatchSpecTrace(
        "re-cinq/lore",
        "specs",
        { commit: "abc123" },
        { projectFor: f.projectFor },
      ),
    ).rejects.toThrow(/requires the startLine dep/);
    expect(f.reposAskedFor).toEqual([]);
  });

  it("chunks a force run without a glob into one child event per top-level dir instead of starting a line", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const projectFor = async (_repo: string) => ({
      repo: {
        tree: async () => [
          "specs/auth/spec.md",
          "specs/billing/spec.md",
          ".specify/overview.md",
        ],
        read: async () => {
          throw new Error("chunking must not read file contents");
        },
      },
    });
    const { started, startLine } = startLineRecorder();
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true },
      {
        projectFor,
        startLine,
        insertEvent: async (input) => {
          inserted.push(input as unknown as Record<string, unknown>);
        },
      },
    );

    expect(started).toEqual([]);
    expect(inserted).toHaveLength(3);
    expect(inserted[0]).toMatchObject({
      eventName: "internal.ingest.spec_trace",
      source: "internal",
      dedupeKey: "spec-trace-force:specs:abc123:.specify/",
      params: {
        kind: "specs",
        repo: "re-cinq/lore",
        payload: { commit: "abc123", force: true, glob: ".specify/" },
      },
    });
    expect(
      inserted.map(
        (i) => (i.params as { payload: { glob: string } }).payload.glob,
      ),
    ).toEqual([".specify/", "specs/auth/", "specs/billing/"]);
    expect(result.logLine).toContain("chunked into 3");
  });

  it("starts a line for a force run WITH a glob — chunks never re-chunk", async () => {
    const inserted: unknown[] = [];
    const { started, startLine } = startLineRecorder();
    const f = fakeProjectFor();

    await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true, glob: "specs/auth/" },
      {
        projectFor: f.projectFor,
        startLine,
        insertEvent: async (input) => {
          inserted.push(input);
        },
      },
    );

    expect(inserted).toEqual([]);
    expect(started).toHaveLength(1);
  });

  it("force chunks of one commit lease per glob, so sibling directories never defer to each other", async () => {
    const { started, startLine } = startLineRecorder();
    const f = fakeProjectFor();

    await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true, glob: "specs/auth/" },
      { projectFor: f.projectFor, startLine },
    );
    await dispatchSpecTrace(
      "re-cinq/lore",
      "specs",
      { commit: "abc123", force: true, glob: "specs/billing/" },
      { projectFor: f.projectFor, startLine },
    );

    expect(started.map((s) => s.branch)).toEqual([
      "ingest/specs/abc123/specs/auth/",
      "ingest/specs/abc123/specs/billing/",
    ]);
  });

  it("routes a payload kind to the ingest line by event reference", async () => {
    const { started, startLine } = startLineRecorder();
    const f = fakeProjectFor();
    const result = await dispatchSpecTrace(
      "re-cinq/lore",
      "test-report",
      { commit: "abc123", tests: [] },
      { projectFor: f.projectFor, eventId: "4711", startLine },
    );

    expect(started).toEqual([
      {
        blueprintName: "ingest",
        repo: "re-cinq/lore",
        branch: "ingest/test-report/abc123/4711",
        args: { kind: "test-report", ref: "abc123", payload_event_id: "4711" },
      },
    ]);
    expect(result.logLine).toContain("ingest line a1b2c3d4");
  });

  it("test-report chunks of one commit lease per event, so chunk 2 of 40 never defers to chunk 1", async () => {
    const { started, startLine } = startLineRecorder();
    const f = fakeProjectFor();

    await dispatchSpecTrace(
      "re-cinq/lore",
      "test-report",
      { commit: "abc123", tests: [] },
      { projectFor: f.projectFor, eventId: "4711", startLine },
    );
    await dispatchSpecTrace(
      "re-cinq/lore",
      "test-report",
      { commit: "abc123", tests: [] },
      { projectFor: f.projectFor, eventId: "4712", startLine },
    );

    expect(started.map((s) => s.branch)).toEqual([
      "ingest/test-report/abc123/4711",
      "ingest/test-report/abc123/4712",
    ]);
  });

  it("a payload kind without the scheduling event's id is a config error — the pod can only fetch the body by reference", async () => {
    const { startLine } = startLineRecorder();
    const f = fakeProjectFor();

    await expect(
      dispatchSpecTrace(
        "re-cinq/lore",
        "test-report",
        { commit: "abc123", tests: [] },
        { projectFor: f.projectFor, startLine },
      ),
    ).rejects.toThrow(/payload kind .* eventId/);
  });

  it("an unrecognized kind throws without reading the repo or starting a line", async () => {
    const { started, startLine } = startLineRecorder();
    const f = fakeProjectFor();

    await expect(
      dispatchSpecTrace(
        "re-cinq/lore",
        "bogus",
        {},
        { projectFor: f.projectFor, startLine },
      ),
    ).rejects.toThrow(/unknown spec-trace kind "bogus"/);
    expect(f.reposAskedFor).toEqual([]);
    expect(started).toEqual([]);
  });
});
