import { describe, expect, it } from "vitest";
import { startRelease, type ReleaseLineStarter } from "./floor-release.js";

const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

function floorJoiningOpenRuns() {
  const started: Array<{ line: string; repo: unknown; values: unknown }> = [];
  const opened = new Map<string, string>();
  const lines: ReleaseLineStarter = {
    start: (line, starting) => {
      const values = Object.fromEntries(
        Object.entries(starting.startItems ?? {}).map(([name, startItem]) => [
          name,
          (startItem as { ref: string }).ref,
        ]),
      );
      const key = values.release_key as string;
      const joined = opened.has(key);

      opened.set(key, opened.get(key) ?? `run-${opened.size + 1}`);
      started.push({ line, repo: starting.repo, values });

      return Promise.resolve({
        run: { id: opened.get(key) },
        joined,
      } as never);
    },
  };

  return { lines, started };
}

describe("startRelease", () => {
  it("starts the release line for re-cinq/lore-security at a1b2c3d keyed re-cinq/lore-security:a1b2c3d", async () => {
    const { lines, started } = floorJoiningOpenRuns();

    await startRelease(lines, { repo: "re-cinq/lore-security", sha: HEAD });

    expect(started).toMatchObject([
      {
        line: "release",
        values: {
          release_key: `re-cinq/lore-security:${HEAD}`,
          release_repo: "re-cinq/lore-security",
        },
      },
    ]);
  });

  it("joins run-1 when the same commit is started twice and opens run-2 for another commit", async () => {
    const { lines } = floorJoiningOpenRuns();
    const repo = "re-cinq/lore-security";
    const first = await startRelease(lines, { repo, sha: HEAD });
    const second = await startRelease(lines, { repo, sha: HEAD });
    const next = await startRelease(lines, { repo, sha: "f".repeat(40) });

    expect(
      [first, second, next].map(({ run, joined }) => [run.id, joined]),
    ).toEqual([
      ["run-1", false],
      ["run-1", true],
      ["run-2", false],
    ]);
  });
});
