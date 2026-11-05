import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { briefHandle, type BriefDeps } from "./station.js";

const TARGET =
  "https://github.com/re-cinq/otto@lore/implementation-loop/issue-7";

function scene(build: BriefDeps["build"]) {
  const produced: Record<string, string> = {};
  const asked: string[] = [];
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("# Add export (#7)\n\nCSV too.")),
    produce: (name, bytes) => {
      produced[name] = bytes.toString();

      return Promise.resolve();
    },
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const handle = briefHandle({
    build: (repo, ticket) => {
      asked.push(`${repo}: ${ticket}`);

      return build(repo, ticket);
    },
  });

  return {
    produced,
    asked,
    run: () =>
      handle({ needs: { target: TARGET }, iteration: 1 } as never, tools),
  };
}

describe("loop-brief", () => {
  it("asks lore-api for re-cinq/otto's briefing with the ticket's whole text and produces it as the brief file", async () => {
    const { run, produced, asked } = scene(() =>
      Promise.resolve("## Briefing\n\nsrc/export.ts:12 writes the file."),
    );

    expect(await run()).toEqual({ outcome: "success" });
    expect({ produced, asked }).toEqual({
      produced: { brief: "## Briefing\n\nsrc/export.ts:12 writes the file." },
      asked: ["re-cinq/otto: # Add export (#7)\n\nCSV too."],
    });
  });

  it("goes on to the definition of done with no brief when lore-api built none or failed, since the agents can still ask for context themselves", async () => {
    const empty = scene(() => Promise.resolve(null));
    const failed = scene(() => Promise.reject(new Error("502")));

    expect([await empty.run(), await failed.run()]).toEqual([
      { outcome: "success" },
      { outcome: "success" },
    ]);
    expect([empty.produced, failed.produced]).toEqual([{}, {}]);
  });
});
