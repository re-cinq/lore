// Every `prompt_ref` a shipped assembly line names must exist as a task type in
// scripts/task-types.yaml — the file the Floor resolves node prompts from.
//
// This is a drift guard for a failure that produced no error for weeks: the
// resolver fell back to `general` for an unknown ref, so `push-only` (named by
// five lines) and `address-feedback` (named by the implementation line) both ran
// the generic "complete the following task" prompt. The push nodes committed
// without pushing and reported success; no line opened a PR (re-cinq/lore#1329).
// The resolver now throws, which turns the same drift into a failed node — and
// this test turns it into a failed build, before it reaches a cluster.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";

const TASK_TYPES = new URL("../../../scripts/task-types.yaml", import.meta.url);

async function declaredTaskTypes(): Promise<Set<string>> {
  const parsed = parse(await readFile(TASK_TYPES, "utf-8")) as {
    task_types?: Record<string, unknown>;
  };

  return new Set(Object.keys(parsed.task_types ?? {}));
}

/**
 * What every agent node resolves its prompt by, keyed to the lines that use it.
 *
 * `prompt_ref ?? type` mirrors the Floor's own rule (`advance.ts`), so a node
 * that names no ref is checked through the same fallback it will actually take
 * at dispatch — the guard has to match the resolver or it guards a different
 * program.
 */
async function referencedPrompts(): Promise<Map<string, string[]>> {
  const refs = new Map<string, string[]>();
  const agentNodeRefs = [...(await loadBuiltinAssemblyLines())].flatMap(
    ([name, definition]) =>
      definition.nodes
        .filter((node) => node.type === "agent")
        .map((node) => ({ name, ref: node.prompt_ref ?? node.type })),
  );

  for (const { name, ref } of agentNodeRefs) {
    refs.set(ref, [...(refs.get(ref) ?? []), name]);
  }

  return refs;
}

describe("assembly-line prompt_refs", () => {
  it("every agent node resolves to a task type that exists", async () => {
    const declared = await declaredTaskTypes();
    const unresolved = [...(await referencedPrompts())]
      .filter(([ref]) => !declared.has(ref))
      .map(([ref, lines]) => `${ref} (used by ${lines.join(", ")})`);

    expect(unresolved).toEqual([]);
  });

  it("push-only and address-feedback are declared — both were phantom refs", async () => {
    const declared = await declaredTaskTypes();

    expect([...declared].filter((t) => t === "push-only")).toEqual([
      "push-only",
    ]);
    expect([...declared].filter((t) => t === "address-feedback")).toEqual([
      "address-feedback",
    ]);
  });

  it("the push recipe tells the node to push, which is its whole purpose", async () => {
    const parsed = parse(await readFile(TASK_TYPES, "utf-8")) as {
      task_types: Record<string, { prompt_template: string }>;
    };

    expect(parsed.task_types["push-only"].prompt_template).toContain(
      "git push",
    );
  });
});
