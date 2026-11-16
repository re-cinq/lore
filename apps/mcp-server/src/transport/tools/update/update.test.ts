import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { registerUpdateTool } from "./update.js";

const sandbox = await vi.hoisted(async () => {
  const {
    mkdtempSync,
    mkdirSync,
    writeFileSync: write,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execSync } = await import("node:child_process");
  const root = mkdtempSync(`${tmpdir()}/lore-update-`);
  const git = (cwd: string, cmd: string) =>
    execSync(`git -c user.name=t -c user.email=t@t ${cmd}`, {
      cwd,
      encoding: "utf8",
    }).trim();
  const origin = `${root}/origin`;
  const checkout = `${root}/checkout`;

  mkdirSync(origin);
  git(origin, "init -q -b main");
  git(origin, "commit -q --allow-empty -m one");
  git(root, `clone -q ${origin} ${checkout}`);
  git(origin, "commit -q --allow-empty -m two");
  git(checkout, "fetch -q origin");
  mkdirSync(`${checkout}/scripts`);
  write(`${checkout}/scripts/lore-update.sh`, "echo rebuilt\n");
  mkdirSync(`${root}/.lore`);
  process.env.HOME = root;
  process.env.CONTEXT_PATH = checkout;

  return {
    marker: `${root}/.lore/mcp-build-head`,
    builtSha: git(checkout, "rev-parse HEAD"),
    remoteSha: git(origin, "rev-parse HEAD"),
  };
});
const update = toolHandlers(registerUpdateTool, "full")["lore_update"];

beforeEach(() => {
  vi.stubEnv("LORE_API_URL", "https://lore-api.example.com");
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ latest: { build: sandbox.remoteSha.slice(0, 7) } }),
    })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lore_update", () => {
  it("names the deployed build and the 1 commit the adapter is behind before the updater's output", async () => {
    writeFileSync(sandbox.marker, sandbox.builtSha);

    const result = await update({});

    expect(result.content[0].text).toBe(
      `Updating — behind the deployed version (${sandbox.builtSha.slice(0, 7)} → ${sandbox.remoteSha.slice(0, 7)}), 1 commit(s).\nrebuilt\n\nRestart Claude Code to load the rebuilt MCP, and reload the VS Code window if the extension was installed.`,
    );
  });

  it("prints only the updater's output when the adapter is the deployed build", async () => {
    writeFileSync(sandbox.marker, sandbox.remoteSha);

    const result = await update({});

    expect(result.content[0].text).toBe(
      "rebuilt\n\nRestart Claude Code to load the rebuilt MCP, and reload the VS Code window if the extension was installed.",
    );
  });
});
