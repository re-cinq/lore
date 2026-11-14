import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it, expect } from "vitest";
import { keepingRunRepos } from "./run-repo.js";

function countingReader(repos: Record<string, string>) {
  const asked: string[] = [];
  const read = async (runId: string) => {
    asked.push(runId);

    return repos[runId] ?? null;
  };

  return { asked, read };
}

describe("keepingRunRepos", () => {
  it("reads run r1's repo once for five requests", async () => {
    const { asked, read } = countingReader({ r1: "re-cinq/lore" });
    const repoOf = keepingRunRepos(read);

    const repos = await Promise.all(
      Array.from({ length: 5 }, () => repoOf("r1")),
    );

    await repoOf("r1");

    expect({ repos, asked }).toEqual({
      repos: Array(5).fill("re-cinq/lore"),
      asked: ["r1"],
    });
  });

  it("reads an unknown run again on the next request", async () => {
    const { asked, read } = countingReader({});
    const repoOf = keepingRunRepos(read);

    await repoOf("r9");
    await repoOf("r9");

    expect(asked).toEqual(["r9", "r9"]);
  });

  it("reads a run again after its read failed", async () => {
    let calls = 0;
    const repoOf = keepingRunRepos(async () => {
      enforceTrue(calls++ !== 0, Error, "floor away");

      return "re-cinq/lore";
    });

    await expect(repoOf("r1")).rejects.toThrow(new Error("floor away"));

    expect(await repoOf("r1")).toEqual("re-cinq/lore");
  });

  it("drops the oldest answer once more than the cap are kept", async () => {
    const { asked, read } = countingReader({ a: "o/a", b: "o/b", c: "o/c" });
    const repoOf = keepingRunRepos(read, 2);

    await Promise.all([repoOf("a"), repoOf("b"), repoOf("c")]);
    await repoOf("a");
    await repoOf("c");

    expect(asked).toEqual(["a", "b", "c", "a"]);
  });
});
