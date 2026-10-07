import { describe, expect, it } from "vitest";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { decodeDigestRepos } from "@re-cinq/lore-shared/digest/codec.js";
import { digestTick, type DigestTickDeps } from "./digest-tick.js";

const FRIDAY_0905_BERLIN = new Date("2026-09-25T07:05:00Z");

const repoRow = (
  full_name: string,
  channel: string | undefined,
  digest: Record<string, unknown> = { enabled: true },
) => ({ full_name, settings: { slack_channel_id: channel, digest } });

interface FloorRun {
  id: string;
  finishedAt: string | null;
}

function scene(rows: ReturnType<typeof repoRow>[], floorRuns: FloorRun[] = []) {
  const listed: unknown[] = [];
  const started: Array<{ line: string; starting: Record<string, unknown> }> =
    [];
  const deps = {
    repoSettings: () => Promise.resolve(rows),
    posts: new InMemoryDigestPosts(() => FRIDAY_0905_BERLIN),
    now: () => FRIDAY_0905_BERLIN,
    floor: {
      runs: {
        list: (filter: unknown) => {
          listed.push(filter);

          return Promise.resolve({ items: floorRuns });
        },
      },
      lines: {
        start: (line: string, starting: Record<string, unknown>) => {
          started.push({ line, starting });

          return Promise.resolve({ run: { id: "run-new" }, joined: false });
        },
      },
    },
  } as unknown as DigestTickDeps;

  return { deps, listed, started };
}

const valuesOf = (starting: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(starting.startItems as Record<string, { ref: string }>).map(
      ([name, started]) => [name, started.ref],
    ),
  );

describe("the digest tick on the external floor", () => {
  it("starts daily-digest once for channel C1 on github.com/re-cinq/lore, keyed C1:2026-09-25:09:00", async () => {
    const { deps, started } = scene([repoRow("Re-Cinq/Lore", "C1")]);
    const summary = await digestTick({}, deps);

    expect(summary).toBe("started 1 of 1 due channel(s)");
    expect(started).toMatchObject([
      { line: "daily-digest", starting: { repo: "github.com/re-cinq/lore" } },
    ]);
    expect(valuesOf(started[0].starting)).toMatchObject({
      digest_key: "C1:2026-09-25:09:00",
      channel: "C1",
      channel_repos: "Re-Cinq/Lore",
      week_key: "2026-W39",
      digest_date: "2026-09-25",
    });
  });

  it("carries re-cinq/lore and re-cinq/otto of channel C1 in one run", async () => {
    const { deps, started } = scene([
      repoRow("re-cinq/otto", "C1"),
      repoRow("re-cinq/lore", "C1"),
    ]);

    await digestTick({}, deps);

    expect(started).toHaveLength(1);
    expect(
      decodeDigestRepos(valuesOf(started[0].starting).digest_repos).map(
        (entry) => entry.repo,
      ),
    ).toEqual(["re-cinq/lore", "re-cinq/otto"]);
  });

  it("sends the voice Michael Scott as a start value, and no voice value when none is set", async () => {
    const voiced = scene([
      repoRow("re-cinq/lore", "C1", { enabled: true, voice: "Michael Scott" }),
    ]);
    const plain = scene([repoRow("re-cinq/lore", "C1")]);

    await digestTick({}, voiced.deps);
    await digestTick({}, plain.deps);

    expect(valuesOf(voiced.started[0].starting).voice).toBe("Michael Scott");
    expect(valuesOf(plain.started[0].starting)).not.toHaveProperty("voice");
  });

  it("asks the floor for the runs of daily-digest with subject digest_key:C1:2026-09-25:09:00", async () => {
    const { deps, listed } = scene([repoRow("re-cinq/lore", "C1")]);

    await digestTick({}, deps);

    expect(listed[0]).toEqual({
      repo: "github.com/re-cinq/lore",
      line: "daily-digest",
      subject: "digest_key:C1:2026-09-25:09:00",
    });
  });

  it("starts nothing for a channel whose digest run is still open", async () => {
    const { deps, started } = scene(
      [repoRow("re-cinq/lore", "C1")],
      [{ id: "run-1", finishedAt: null }],
    );

    expect(await digestTick({}, deps)).toBe("started 0 of 1 due channel(s)");
    expect(started).toEqual([]);
  });

  it("starts nothing for a channel that already had 3 runs for this slot", async () => {
    const settled = ["run-1", "run-2", "run-3"].map((id) => ({
      id,
      finishedAt: "2026-09-25T07:01:00Z",
    }));
    const { deps, started } = scene([repoRow("re-cinq/lore", "C1")], settled);

    await digestTick({}, deps);

    expect(started).toEqual([]);
  });

  it("starts nothing before a repo's 09:00 Berlin slot, and nothing for a repo with the digest off", async () => {
    const early = scene([repoRow("re-cinq/lore", "C1")]);

    early.deps.now = () => new Date("2026-09-25T06:30:00Z");
    const off = scene([repoRow("re-cinq/lore", "C1", { enabled: false })]);

    expect(await digestTick({}, early.deps)).toBe(
      "started 0 of 0 due channel(s)",
    );
    expect(await digestTick({}, off.deps)).toBe(
      "started 0 of 0 due channel(s)",
    );
  });
});
