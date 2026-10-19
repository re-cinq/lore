import { describe, expect, it } from "vitest";
import { relocateOnTeamChange, type TeamChangeDeps } from "./team-changed.js";

function scene(over: Partial<TeamChangeDeps> = {}) {
  const relocated: string[] = [];
  const resolved: (string | null)[] = [];
  const deps: TeamChangeDeps = {
    team: () => Promise.resolve("platform"),
    chunkSchema: (team) => {
      resolved.push(team);

      return Promise.resolve(team ?? "org_shared");
    },
    relocate: (schema, repo) => {
      relocated.push(`${repo} into ${schema}`);

      return Promise.resolve({ moved: 5, dropped: 7 });
    },
    ...over,
  };

  return { deps, relocated, resolved };
}

describe("relocateOnTeamChange", () => {
  it("moves re-cinq/lore's legacy org_shared rows into platform, the schema its team resolves to", async () => {
    const { deps, relocated } = scene();

    const outcome = await relocateOnTeamChange(deps, "re-cinq/lore");

    expect(relocated).toEqual(["re-cinq/lore into platform"]);
    expect(outcome).toBe(
      "moved 5 of 7 legacy org_shared rows into platform (the rest were stale duplicates of files already there)",
    );
  });

  it("relocates nothing for a repository whose team resolves to org_shared", async () => {
    const { deps, relocated } = scene({
      chunkSchema: () => Promise.resolve("org_shared"),
    });

    const outcome = await relocateOnTeamChange(deps, "re-cinq/lore");

    expect(relocated).toEqual([]);
    expect(outcome).toBe("resolves to org_shared, nothing to relocate");
  });

  it("hands a cleared team to the resolver as null instead of deciding here", async () => {
    const { deps, resolved } = scene({ team: () => Promise.resolve(null) });

    await relocateOnTeamChange(deps, "re-cinq/lore");

    expect(resolved).toEqual([null]);
  });

  it("says there was nothing to move when the repository had no legacy rows", async () => {
    const { deps } = scene({
      relocate: () => Promise.resolve({ moved: 0, dropped: 0 }),
    });

    expect(await relocateOnTeamChange(deps, "re-cinq/lore")).toBe(
      "no legacy org_shared rows to move into platform",
    );
  });

  it("throws connection reset when the move fails, so the delivery is retried", async () => {
    const { deps } = scene({
      relocate: () => Promise.reject(new Error("connection reset")),
    });

    await expect(relocateOnTeamChange(deps, "re-cinq/lore")).rejects.toThrow(
      new Error("connection reset"),
    );
  });
});
