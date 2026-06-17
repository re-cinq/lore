import { spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { StationCredentials, StationLlmCredential } from "@re-cinq/lore-shared";
import { GitHubPlatform } from "./github.js";

/** `gh auth token`, or null if gh is absent / not logged in. */
function ghAuthToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("gh", ["auth", "token"]);
    let out = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
  });
}

/**
 * Local Station credentials (ADR-028). Resolves what the dev already has so the
 * Docker Station works without installing a GitHub App on every repo:
 *  - git token: GITHUB_TOKEN / GH_TOKEN env → `gh auth token` → GitHub App token.
 *    (`re-cinq/lore` is INTERNAL, so the dev's gh token can clone it where an
 *    un-installed App token gets a 404 "Repository not found".)
 *  - LLM: ANTHROPIC_API_KEY (preferred) → mount the host claude config into the
 *    runner's HOME (/home/runner) so the in-container `claude` CLI is authed.
 */
export class LocalStationCredentials implements StationCredentials {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async gitToken(): Promise<string> {
    if (this.env.GITHUB_TOKEN) return this.env.GITHUB_TOKEN;
    if (this.env.GH_TOKEN) return this.env.GH_TOKEN;
    const gh = await ghAuthToken();
    if (gh) return gh;
    return new GitHubPlatform().getInstallationToken();
  }

  async llm(): Promise<StationLlmCredential> {
    if (this.env.ANTHROPIC_API_KEY) return { apiKey: this.env.ANTHROPIC_API_KEY };
    // Mount the host claude config into the runner user's HOME so the in-container
    // `claude` CLI is authed. The claude-runner image runs as user `node`
    // (HOME=/home/node), so the target must match — verified empirically; override
    // with LORE_RUNNER_HOME if the image's user changes.
    const runnerHome = this.env.LORE_RUNNER_HOME || "/home/node";
    const home = os.homedir();
    const mounts = [
      { host: path.join(home, ".claude.json"), container: `${runnerHome}/.claude.json` },
      { host: path.join(home, ".claude"), container: `${runnerHome}/.claude` },
    ]
      .filter((m) => fs.existsSync(m.host))
      .map((m) => ({ hostPath: m.host, containerPath: m.container }));
    return mounts.length > 0 ? { mounts } : {};
  }
}
