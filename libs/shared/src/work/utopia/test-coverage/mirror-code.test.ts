import { describe, it, expect } from "vitest";
import { mirrorCodeFiles, tombstoneCodeFiles } from "./mirror-code.js";
import { MAX_CODE_FILE_CHARS } from "../../spec-trace/project-code-file.js";
import { relation, type PushItem } from "../../../domain/utopia/statements.js";
import type { PushAction } from "../../../outbound/utopia/utopia-client.js";

function pushClient(answer: PushAction) {
  const pushed: PushItem[] = [];

  return {
    pushed,
    push: async (candidate: PushItem) => {
      pushed.push(candidate);

      return { action: answer };
    },
  };
}

const RUNNER = [
  'import { nextTransition } from "./transition.js";',
  "",
  "export function advance(state: number) {",
  "  return nextTransition(state);",
  "}",
].join("\n");

describe("mirrorCodeFiles", () => {
  it("pushes code:src/runner.ts with advance referencing src/transition.ts#nextTransition and skips a file past MAX_CODE_FILE_CHARS", async () => {
    const client = pushClient("created");
    const outcome = await mirrorCodeFiles(client, {
      repo: "re-cinq/lore",
      files: [
        { path: "src/runner.ts", content: RUNNER },
        { path: "src/huge.ts", content: "x".repeat(MAX_CODE_FILE_CHARS + 1) },
      ],
    });
    const references = client.pushed.flatMap((pushed) =>
      "s" in pushed ? pushed.s.filter((row) => row[2] === "references") : [],
    );

    expect({
      outcome,
      ids: client.pushed.map((pushed) => pushed.externalId),
      references,
    }).toEqual({
      outcome: { items: 1, created: 1, updated: 0, unchanged: 0, failed: [] },
      ids: ["code:src/runner.ts"],
      references: [
        relation(
          "re-cinq/lore:src/runner.ts#advance",
          "references",
          "re-cinq/lore:src/transition.ts#nextTransition",
        ),
      ],
    });
  });
});

describe("tombstoneCodeFiles", () => {
  it("pushes a code:<path> tombstone for each deleted source file", async () => {
    const client = pushClient("marked_missing");

    await tombstoneCodeFiles(client, ["src/gone.ts"]);

    expect(client.pushed).toEqual([
      { externalId: "code:src/gone.ts", deleted: true },
    ]);
  });
});
