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

    // Give the in-container `claude` CLI a WRITABLE copy of just the auth files so
    // it can refresh an expired oauth token (a read-only mount made it hang with
    // 0 network — refresh couldn't write). We copy only ~/.claude.json (60K) +
    // ~/.claude/.credentials.json (the tokens) — NOT the 1.3G ~/.claude dir — into
    // a stable per-user dir, refreshed each launch from the host (which the live
    // session keeps current). The container mutates the COPY, never the host, so
    // there's no race with your running claude session. The image runs as user
    // `node` (HOME=/home/node); override with LORE_RUNNER_HOME.
    const runnerHome = this.env.LORE_RUNNER_HOME || "/home/node";
    const home = os.homedir();
    const srcJson = path.join(home, ".claude.json");
    const srcCreds = path.join(home, ".claude", ".credentials.json");
    if (!fs.existsSync(srcJson) && !fs.existsSync(srcCreds)) return {};

    const work = path.join(home, ".lore", "station-claude");
    const dotClaude = path.join(work, "dot-claude");
    fs.mkdirSync(dotClaude, { recursive: true });
    const mounts: StationLlmCredential["mounts"] = [];
    if (fs.existsSync(srcJson)) {
      const dst = path.join(work, ".claude.json");
      fs.copyFileSync(srcJson, dst);
      mounts.push({ hostPath: dst, containerPath: `${runnerHome}/.claude.json`, readOnly: false });
    }
    if (fs.existsSync(srcCreds)) {
      const dst = path.join(dotClaude, ".credentials.json");
      fs.copyFileSync(srcCreds, dst);
      fs.chmodSync(dst, 0o600);
    }
    mounts.push({ hostPath: dotClaude, containerPath: `${runnerHome}/.claude`, readOnly: false });
    return { mounts };
  }
}
