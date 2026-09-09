import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

/** The installed checkout the local MCP runs from (set by install.sh). */
const LORE_DIR =
  process.env.CONTEXT_PATH || join(homedir(), ".re-cinq", "lore");
/** SHA the running dist was built from — written by lore-update.sh / install.sh. */
const BUILD_MARKER = join(homedir(), ".lore", "mcp-build-head");
/** The audited updater the lore_update tool runs. */
const UPDATE_SCRIPT = join(LORE_DIR, "scripts", "lore-update.sh");

export interface UpdateStatus {
  updateAvailable: boolean;
  commitsBehind: number;
  builtSha: string | null;
  remoteSha: string | null;
}

const NO_UPDATE: UpdateStatus = {
  updateAvailable: false,
  commitsBehind: 0,
  builtSha: null,
  remoteSha: null,
};

// Pure decision: an update is offered only when origin/main is strictly ahead of the SHA the running dist was built from.
export function deriveUpdateStatus(
  builtSha: string | null,
  remoteSha: string | null,
  commitsBehind: number,
): UpdateStatus {
  const sameOrMissing = !builtSha || !remoteSha || builtSha === remoteSha;

  if (sameOrMissing || commitsBehind <= 0) {
    return { ...NO_UPDATE, builtSha, remoteSha };
  }

  return { updateAvailable: true, commitsBehind, builtSha, remoteSha };
}

async function git(args: string[], timeoutMs = 8000): Promise<string> {
  const { stdout } = await execFileP("git", ["-C", LORE_DIR, ...args], {
    timeout: timeoutMs,
    windowsHide: true,
  });

  return stdout.trim();
}

// Fetches origin/main and compares to the built SHA; any failure (no checkout, offline, git missing) resolves to "no update" so the MCP never nags on a bad signal.
export async function computeUpdateStatus(): Promise<UpdateStatus> {
  try {
    const marker = await readFile(BUILD_MARKER, "utf8").catch(() => "");
    const builtSha =
      marker.trim() || (await git(["rev-parse", "HEAD"]).catch(() => ""));

    if (!builtSha) {
      return NO_UPDATE;
    }
    await git(["fetch", "--quiet", "origin", "main"]);
    const remoteSha = await git(["rev-parse", "origin/main"]);
    const count = await git([
      "rev-list",
      "--count",
      `${builtSha}..${remoteSha}`,
    ]).catch(() => "0");

    return deriveUpdateStatus(builtSha, remoteSha, parseInt(count, 10) || 0);
  } catch {
    return NO_UPDATE;
  }
}

let cached: Promise<UpdateStatus> | null = null;

/** Compute once per process (lazy on first call), then reuse the result. */
export function getUpdateStatus(): Promise<UpdateStatus> {
  if (!cached) {
    cached = computeUpdateStatus();
  }

  return cached;
}

/** Prefix line for lore_assemble_context when the local MCP is behind (else ""). */
export async function updateBanner(): Promise<string> {
  const status = await getUpdateStatus();

  if (!status.updateAvailable) {
    return "";
  }

  return (
    `⚠ lore_mcp_update_available: your local Lore MCP is ${status.commitsBehind} ` +
    `commit(s) behind origin/main. Offer to run the lore_update tool, then restart Claude Code.\n\n`
  );
}

// Runs the audited updater (git pull + npm ci --ignore-scripts + build) and resets the cached status so a later check reflects the rebuild.
export async function runUpdate(): Promise<string> {
  cached = null;

  try {
    const { stdout, stderr } = await execFileP("bash", [UPDATE_SCRIPT], {
      timeout: 300_000,
    });

    return `${stdout}${stderr}`.trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };

    return `${e.stdout ?? ""}${e.stderr ?? ""}\n${e.message ?? "lore-update failed"}`.trim();
  }
}
