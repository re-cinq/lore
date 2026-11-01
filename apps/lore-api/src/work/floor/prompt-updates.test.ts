import { describe, expect, it } from "vitest";
import {
  applyPromptUpdates,
  type PromptUpdate,
  type PromptUpdateDeps,
} from "./prompt-updates.js";

const SHIPPED: Record<string, string> = {
  "loop-dod": "the new dod prompt",
  "loop-sync": "the new sync prompt",
};

function deps(pending: PromptUpdate[], refused: string[] = []) {
  const written: Record<string, string> = {};
  const applied: number[] = [];
  const updates: PromptUpdateDeps = {
    pending: () => Promise.resolve(pending),
    shippedPrompt: (name) => SHIPPED[name],
    writePrompt: (agent, prompt) => {
      if (refused.includes(agent)) {
        return Promise.reject(new Error(`floor refused ${agent}`));
      }

      written[agent] = prompt;

      return Promise.resolve();
    },
    markApplied: (id) => {
      applied.push(id);

      return Promise.resolve();
    },
  };

  return { updates, written, applied };
}

describe("applyPromptUpdates", () => {
  it("writes loop-dod.md's prompt to loop-dod and marks row 1 applied", async () => {
    const { updates, written, applied } = deps([
      { id: 1, agent: "loop-dod", file: "loop-dod.md" },
    ]);

    const outcome = await applyPromptUpdates(updates);

    expect({ written, applied, outcome }).toEqual({
      written: { "loop-dod": "the new dod prompt" },
      applied: [1],
      outcome: { applied: ["loop-dod"], failed: [] },
    });
  });

  it("leaves row 2 pending when no-such.md is not shipped, and still applies row 3", async () => {
    const { updates, written, applied } = deps([
      { id: 2, agent: "loop-dod", file: "no-such.md" },
      { id: 3, agent: "loop-sync", file: "loop-sync.md" },
    ]);

    const outcome = await applyPromptUpdates(updates);

    expect({ written, applied, outcome }).toEqual({
      written: { "loop-sync": "the new sync prompt" },
      applied: [3],
      outcome: {
        applied: ["loop-sync"],
        failed: [
          {
            name: "loop-dod",
            reason: "no shipped agent file no-such.md has a prompt",
          },
        ],
      },
    });
  });

  it("leaves row 4 pending when the floor refuses loop-dod", async () => {
    const { updates, applied } = deps(
      [{ id: 4, agent: "loop-dod", file: "loop-dod.md" }],
      ["loop-dod"],
    );

    const outcome = await applyPromptUpdates(updates);

    expect({ applied, outcome }).toEqual({
      applied: [],
      outcome: {
        applied: [],
        failed: [{ name: "loop-dod", reason: "floor refused loop-dod" }],
      },
    });
  });
});
