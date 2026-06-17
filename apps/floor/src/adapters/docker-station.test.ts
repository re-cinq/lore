import { describe, it, expect } from "vitest";
import { buildDockerRunArgs, parseChanges } from "./docker-station.js";

describe("buildDockerRunArgs", () => {
  const base = {
    image: "lore-claude-runner:local",
    name: "loretask-abc123",
    network: "host",
    env: { TARGET_REPO: "octo/repo", LORE_DARK_FACTORY_WORKFLOW: "feature-planning" },
    secretEnvNames: ["GITHUB_TOKEN", "ANTHROPIC_API_KEY"],
    mounts: [],
  };

  it("runs --rm on the host network with the image last", () => {
    const args = buildDockerRunArgs(base);
    expect(args.slice(0, 6)).toEqual(["run", "--rm", "--name", "loretask-abc123", "--network", "host"]);
    expect(args[args.length - 1]).toBe("lore-claude-runner:local");
  });

  it("passes plain vars as -e NAME=value", () => {
    const args = buildDockerRunArgs(base);
    expect(args).toContain("TARGET_REPO=octo/repo");
    expect(args).toContain("LORE_DARK_FACTORY_WORKFLOW=feature-planning");
  });

  it("passes secrets by-reference (-e NAME, no value) so they stay out of argv", () => {
    const args = buildDockerRunArgs(base);
    expect(args).toContain("GITHUB_TOKEN");
    expect(args).toContain("ANTHROPIC_API_KEY");
    expect(args.some((a) => a.startsWith("GITHUB_TOKEN="))).toBe(false);
    expect(args.some((a) => a.startsWith("ANTHROPIC_API_KEY="))).toBe(false);
  });

  it("adds -v for each read-only mount (e.g. host claude config)", () => {
    const args = buildDockerRunArgs({
      ...base,
      secretEnvNames: ["GITHUB_TOKEN"],
      mounts: [{ hostPath: "/home/dev/.claude.json", containerPath: "/home/runner/.claude.json" }],
    });
    expect(args).toContain("-v");
    expect(args).toContain("/home/dev/.claude.json:/home/runner/.claude.json:ro");
  });
});

describe("parseChanges", () => {
  it("reads the CHANGES marker", () => {
    expect(parseChanges("foo\nCHANGES=3\nbar")).toBe(3);
  });
  it("defaults to 0 when absent", () => {
    expect(parseChanges("no marker here")).toBe(0);
  });
});
