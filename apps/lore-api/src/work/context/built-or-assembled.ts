// The context builder's block when it can write one, the template assembly otherwise: a call is never answered with an error the template path could have answered.

import { errorMessage } from "@re-cinq/lore-shared";

export interface AssembledAnswer {
  text: string;
  sections?: unknown;
  trace?: unknown;
}

/** Whether the block came from the builder: `on`, `off` (no model named for it) or `failed: <reason>`. */
export type BuilderState = "on" | "off" | `failed: ${string}`;

const CHARS_PER_TOKEN = 4;

export type ContextAnswer = AssembledAnswer & { builder: BuilderState };

export async function builtOrAssembled(
  build: (() => Promise<string>) | null,
  assemble: () => Promise<AssembledAnswer>,
): Promise<ContextAnswer> {
  if (!build) {
    return { ...(await assemble()), builder: "off" };
  }
  const block = await build().then(
    (text) => text.trim() || new Error("empty block"),
    (err: unknown) => new Error(errorMessage(err)),
  );

  if (block instanceof Error) {
    return { ...(await assemble()), builder: `failed: ${block.message}` };
  }

  return { ...builtAnswer(block), builder: "on" };
}

function builtAnswer(block: string): AssembledAnswer {
  return {
    text: block,
    sections: [
      {
        header: "Context builder",
        tokens: Math.ceil(block.length / CHARS_PER_TOKEN),
        truncated: false,
      },
    ],
  };
}
