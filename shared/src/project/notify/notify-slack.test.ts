import { describe, it, expect } from "vitest";
import { NotifySlack } from "./notify-slack.js";
import type { PgPool } from "../../memory-store.js";

/**
 * NotifySlack resolves the repo's channels via a fake PgPool and returns the
 * decision. With no Slack token in env, no network call is attempted — the
 * decision wiring is what we assert here (the post itself is integration).
 */

function fakePool(rows: unknown[]): PgPool {
  return { query: async () => ({ rows }) };
}

describe("NotifySlack", () => {
  it("fires an escalation using the repo's resolved channels", async () => {
    const slack = new NotifySlack(fakePool([{ settings: { dark_factory: { notify: ["watched"] } } }]), {});

    expect(await slack.notify("re-cinq/lore", "escalation", "pod died")).toEqual({
      fire: true,
      matchedChannels: ["escalation"],
    });
  });

  it("suppresses a pr_open when the repo's channels do not include all", async () => {
    const slack = new NotifySlack(fakePool([{ settings: { dark_factory: { notify: ["watched"] } } }]), {});

    expect(await slack.notify("re-cinq/lore", "pr_open", "PR #1")).toEqual({ fire: false, matchedChannels: [] });
  });
});
