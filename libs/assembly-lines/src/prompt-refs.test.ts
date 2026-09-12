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

describe("the fix-ci recipe behind repair-build", () => {
  async function fixCiPrompt(): Promise<string> {
    const parsed = parse(await readFile(TASK_TYPES, "utf-8")) as {
      task_types: Record<string, { prompt_template: string }>;
    };

    return parsed.task_types["fix-ci"].prompt_template;
  }

  it("tells the node to fix an annotated file:line with an editor, never an install, never a repo-wide lint, and to ask CI through lore_get_ci_failures and lore_get_ci_job_log rather than rebuild", async () => {
    const prompt = (await fixCiPrompt()).replace(/\s+/g, " ");
    const says = (phrase: string) => prompt.includes(phrase);

    expect({
      editsTheAnnotatedLine: says(
        "open that file at that line and fix what it says",
      ),
      forbidsInstall: says("needs an editor, not `npm ci`"),
      asksCi: says("call `lore_get_ci_failures` with no arguments"),
      readsTheLog: says(
        "call `lore_get_ci_job_log` with that failure's `job_id`",
      ),
      forbidsRebuild: says(
        "Never reinstall or rebuild the workspace to learn what CI already printed.",
      ),
    }).toEqual({
      editsTheAnnotatedLine: true,
      forbidsInstall: true,
      asksCi: true,
      readsTheLog: true,
      forbidsRebuild: true,
    });
  });
});
