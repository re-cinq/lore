import { describe, expect, it } from "vitest";
import { InMemoryDigestPosts } from "@re-cinq/lore-shared/project/digest-posts/digest-posts-memory.js";
import { digestTick, type DigestTickDeps } from "./digest-tick.js";

const FRIDAY_0905_BERLIN = new Date("2026-09-25T07:05:00Z");

const repoRow = (
  full_name: string,
  channel: string | undefined,
  digest: Record<string, unknown> = { enabled: true },
) => ({ full_name, settings: { slack_channel_id: channel, digest } });

function scene(rows: ReturnType<typeof repoRow>[]) {
  const started: Array<{ line: string; starting: Record<string, unknown> }> =
    [];
  const deps = {
    repoSettings: () => Promise.resolve(rows),
    orgSetting: (key: string) =>
      key === "slack_users"
        ? Promise.resolve('{"github_user":"U123"}')
        : Promise.resolve(null),
    posts: new InMemoryDigestPosts(() => FRIDAY_0905_BERLIN),
    now: () => FRIDAY_0905_BERLIN,
    floor: {
      runs: {
        list: () => Promise.resolve({ items: [] }),
      },
      lines: {
        start: (line: string, starting: Record<string, unknown>) => {
          started.push({ line, starting });
          return Promise.resolve({ run: { id: "run-new" }, joined: false });
        },
      },
    },
  } as unknown as DigestTickDeps;

  return { deps, started };
}

const valuesOf = (starting: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(starting.startItems as Record<string, { ref: string }>).map(
      ([name, started]) => [name, started.ref],
    ),
  );

describe("the digest tick on the external floor", () => {
  it("reads slack_users from orgSetting and forwards it to the floor", async () => {
    const { deps, started } = scene([repoRow("Re-Cinq/Lore", "C1")]);

    await digestTick({}, deps);

    expect(started).toHaveLength(1);
    expect(valuesOf(started[0].starting)).toHaveProperty(
      "slack_users",
      '{"github_user":"U123"}',
    );
  });
});
