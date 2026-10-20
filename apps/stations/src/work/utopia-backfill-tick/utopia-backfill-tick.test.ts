import { describe, expect, it } from "vitest";
import {
  NO_UTOPIA,
  utopiaBackfillTick,
  type BackfillAnswer,
} from "./utopia-backfill-tick.js";

const mirrored = (failed: string[] = []): BackfillAnswer => ({
  status: 200,
  body: JSON.stringify({
    commit: "abc1234def",
    documents: 3,
    created: 2,
    updated: 1,
    unchanged: 4,
    failed,
  }),
});

function scene(answers: Record<string, BackfillAnswer | Error>) {
  const asked: string[] = [];
  const logged: string[] = [];
  const deps = {
    repos: () => Promise.resolve(Object.keys(answers)),
    backfill: (repo: string) => {
      asked.push(repo);
      const answer = answers[repo];

      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    log: (line: string) => logged.push(line),
  };

  return { deps, asked, logged };
}

describe("utopiaBackfillTick", () => {
  it("backfills re-cinq/lore then re-cinq/floor in order and reports both done", async () => {
    const { deps, asked, logged } = scene({
      "re-cinq/lore": mirrored(),
      "re-cinq/floor": mirrored(),
    });

    expect(await utopiaBackfillTick(deps)).toBe(
      "utopia backfill: 2 done (re-cinq/lore, re-cinq/floor), 0 skipped, 0 failed",
    );
    expect({ asked, logged }).toEqual({
      asked: ["re-cinq/lore", "re-cinq/floor"],
      logged: [
        "re-cinq/lore: 3 documents at abc1234: 2 created, 1 updated, 4 unchanged, 0 failed",
        "re-cinq/floor: 3 documents at abc1234: 2 created, 1 updated, 4 unchanged, 0 failed",
      ],
    });
  });

  it("skips re-cinq/otto, which answers 409 utopia_not_set_up, and still backfills re-cinq/lore", async () => {
    const { deps, logged } = scene({
      "re-cinq/otto": { status: 409, body: '{"code":"utopia_not_set_up"}' },
      "re-cinq/lore": mirrored(),
    });

    expect(await utopiaBackfillTick(deps)).toBe(
      "utopia backfill: 1 done (re-cinq/lore), 1 skipped (re-cinq/otto), 0 failed",
    );
    expect(logged[0]).toBe(
      're-cinq/otto: skipped, {"code":"utopia_not_set_up"}',
    );
  });

  it("logs re-cinq/otto's 500, re-cinq/hal's refused document and re-cinq/ui's dropped socket as failed, and still backfills re-cinq/lore after them", async () => {
    const { deps, asked, logged } = scene({
      "re-cinq/otto": { status: 500, body: "internal" },
      "re-cinq/hal": mirrored(["specs/a/spec.md: refused"]),
      "re-cinq/ui": new Error("socket hang up"),
      "re-cinq/lore": mirrored(),
    });

    expect(await utopiaBackfillTick(deps)).toBe(
      "utopia backfill: 1 done (re-cinq/lore), 0 skipped, 3 failed (re-cinq/otto, re-cinq/hal, re-cinq/ui)",
    );
    expect({
      asked,
      logged: logged.filter((line) => !line.includes("lore")),
    }).toEqual({
      asked: ["re-cinq/otto", "re-cinq/hal", "re-cinq/ui", "re-cinq/lore"],
      logged: [
        "re-cinq/otto: HTTP 500 internal",
        "re-cinq/hal: 3 documents at abc1234: 2 created, 1 updated, 4 unchanged, 1 failed",
        "re-cinq/hal:   failed: specs/a/spec.md: refused",
        "re-cinq/ui: socket hang up",
      ],
    });
  });

  it("stops at the first 503 and asks for no other repo, since this deployment has no Utopia", async () => {
    const { deps, asked } = scene({
      "re-cinq/lore": { status: 503, body: "" },
      "re-cinq/floor": mirrored(),
    });

    expect(await utopiaBackfillTick(deps)).toBe(NO_UTOPIA);
    expect(asked).toEqual(["re-cinq/lore"]);
  });

  it("counts re-cinq/otto's 200 with an unreadable body as failed and still backfills re-cinq/lore", async () => {
    const { deps, asked } = scene({
      "re-cinq/otto": { status: 200, body: "<html>proxy error</html>" },
      "re-cinq/lore": mirrored(),
    });

    expect({ summary: await utopiaBackfillTick(deps), asked }).toEqual({
      summary:
        "utopia backfill: 1 done (re-cinq/lore), 0 skipped, 1 failed (re-cinq/otto)",
      asked: ["re-cinq/otto", "re-cinq/lore"],
    });
  });
});
