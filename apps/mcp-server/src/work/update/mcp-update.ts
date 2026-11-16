import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";

import { adapterBuild, latestBuild } from "../versions/versions-api.js";

const execFileP = promisify(execFile);

/** The installed checkout the local MCP runs from (set by install.sh). */
const LORE_DIR =
  process.env.CONTEXT_PATH || join(homedir(), ".re-cinq", "lore");
/** The audited updater the lore_update tool runs. */
const UPDATE_SCRIPT = join(LORE_DIR, "scripts", "lore-update.sh");

/** Where the deployed build stands to the adapter's: "ahead" when it is an ancestor of the adapter's build, "behind" when not, "unknown" when the local checkout lacks one of them. */
export type Relation = "behind" | "ahead" | "unknown";

export interface UpdateStatus {
  updateAvailable: boolean;
  /** Known only when the local checkout holds both commits. */
  commitsBehind: number | null;
  builtSha: string | null;
  /** lore-api's `latest.build` from GET /api/versions: the build deployed now. */
  latestSha: string | null;
}

// Pure decision: offered when the adapter's build is not the deployed one and the deployed one is not behind it. The deployed build is a short sha, the marker a full one.
export function deriveUpdateStatus(
  builtSha: string | null,
  latestSha: string | null,
  relation: Relation,
  commitsBehind: number | null,
): UpdateStatus {
  const current = !builtSha || !latestSha || builtSha.startsWith(latestSha);
  const updateAvailable = !current && relation !== "ahead";

  return {
    updateAvailable,
    commitsBehind: updateAvailable ? commitsBehind : null,
    builtSha,
    latestSha,
  };
}

// Asks lore-api for the deployed build and compares it to the adapter's; a missing build, an unreachable API or a checkout git cannot read resolves to "no update", so the MCP never nags on a bad signal.
export async function computeUpdateStatus(): Promise<UpdateStatus> {
  const [builtSha, latestSha] = await Promise.all([
    builtBuild(),
    latestBuild().catch(() => null),
  ]);

  if (!builtSha || !latestSha) {
    return deriveUpdateStatus(builtSha, latestSha, "unknown", null);
  }
  const relation = await relationOf(builtSha, latestSha);
  const count =
    relation === "behind" ? await commitsBetween(builtSha, latestSha) : null;

  return deriveUpdateStatus(builtSha, latestSha, relation, count);
}

async function builtBuild(): Promise<string | null> {
  const marker = await adapterBuild();

  return marker || (await git(["rev-parse", "HEAD"]).catch(() => "")) || null;
}

async function relationOf(
  builtSha: string,
  latestSha: string,
): Promise<Relation> {
  try {
    await git(["merge-base", "--is-ancestor", latestSha, builtSha]);

    return "ahead";
  } catch (err) {
    return (err as { code?: number }).code === 1 ? "behind" : "unknown";
  }
}

async function commitsBetween(
  builtSha: string,
  latestSha: string,
): Promise<number | null> {
  const count = await git([
    "rev-list",
    "--count",
    `${builtSha}..${latestSha}`,
  ]).catch(() => "");

  return count ? parseInt(count, 10) : null;
}

async function git(args: string[], timeoutMs = 8000): Promise<string> {
  const { stdout } = await execFileP("git", ["-C", LORE_DIR, ...args], {
    timeout: timeoutMs,
    windowsHide: true,
  });

  return stdout.trim();
}

let cached: Promise<UpdateStatus> | null = null;

/** Compute once per process (lazy on first call), then reuse the result. */
export function getUpdateStatus(): Promise<UpdateStatus> {
  if (!cached) {
    cached = computeUpdateStatus();
  }

  return cached;
}

/** Prefix line for lore_assemble_context when the local MCP is behind the deployed build (else ""). */
export async function updateBanner(): Promise<string> {
  const status = await getUpdateStatus();

  if (!status.updateAvailable) {
    return "";
  }

  return (
    `⚠ lore_mcp_update_available: your local Lore MCP is ${behindText(status)}. ` +
    `Offer to run the lore_update tool, then restart Claude Code.\n\n`
  );
}

/** "behind the deployed version (built → latest)", with the commit count when the checkout knows it. */
export function behindText(status: UpdateStatus): string {
  const count =
    status.commitsBehind === null ? "" : `, ${status.commitsBehind} commit(s)`;

  return `behind the deployed version (${status.builtSha?.slice(0, 7)} → ${status.latestSha})${count}`;
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
