import { describe, it, expect } from "vitest";
import { Notify } from "./notify.js";
import type { NotifyPort, NotifyLevel } from "./notify-port.js";

/**
 * project.notify binds the repo and passes the level/message through to the
 * port. The fake records what it was asked to deliver.
 */

function fakeNotify(
  sent: Array<{ repo: string; level: NotifyLevel; message: string }>,
): NotifyPort {
  return {
    notify: async (repo, level, message) => {
      const fire = level === "escalation";

      if (fire) {
        sent.push({ repo, level, message });
      }

      return { fire, matchedChannels: fire ? ["escalation"] : [] };
    },
  };
}

describe("Notify", () => {
  it("delivers an escalation bound to the repo", async () => {
    const sent: Array<{ repo: string; level: NotifyLevel; message: string }> =
      [];
    const facade = new Notify("re-cinq/lore", fakeNotify(sent));

    const result = await facade.notify("escalation", "pod died");

    expect(result).toEqual({ fire: true, matchedChannels: ["escalation"] });
    expect(sent).toEqual([
      { repo: "re-cinq/lore", level: "escalation", message: "pod died" },
    ]);
  });

  it("does not deliver a pr_open when the repo's channels do not authorize it", async () => {
    const facade = new Notify("re-cinq/lore", fakeNotify([]));

    expect(await facade.notify("pr_open", "PR #1")).toEqual({
      fire: false,
      matchedChannels: [],
    });
  });
});
