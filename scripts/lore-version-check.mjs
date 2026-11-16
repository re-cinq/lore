#!/usr/bin/env node
// lore-version-check.mjs — run by the SessionStart hook lore-merge-settings.js installs.
// Prints one line when the local Lore MCP adapter is behind the build deployed on
// lore-api (GET /api/versions `latest.build`), and nothing otherwise. Never fails a
// session: no marker, no API, offline or a slow answer all print nothing.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LORE_DIR = join(homedir(), ".re-cinq", "lore");
const MARKER = join(homedir(), ".lore", "mcp-build-head");
const TIMEOUT_MS = 3000;

/** `relation` is "ahead" when the latest build is an ancestor of the built one, "behind" when it is not, "unknown" when the checkout lacks a commit. */
export function behindLine(built, latest, relation) {
  const current = !built || !latest || built.startsWith(latest);

  if (current || relation === "ahead") {
    return "";
  }

  return `[lore] Your Lore MCP is behind the deployed version (${built.slice(0, 7)} → ${latest}). Ask Claude to run lore_update.`;
}

function gitConfig(key) {
  try {
    return execFileSync("git", ["config", "--global", key], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

async function latestBuild() {
  const url = process.env.LORE_API_URL || gitConfig("lore.api-url");
  const token = process.env.LORE_INGEST_TOKEN || gitConfig("lore.ingest-token");

  if (!url || !token) {
    return null;
  }
  const response = await fetch(`${url}/api/versions`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  return response.ok ? ((await response.json()).latest?.build ?? null) : null;
}

function relationOf(built, latest) {
  try {
    execFileSync(
      "git",
      ["-C", LORE_DIR, "merge-base", "--is-ancestor", latest, built],
      {
        stdio: "ignore",
      },
    );

    return "ahead";
  } catch (err) {
    return err.status === 1 ? "behind" : "unknown";
  }
}

async function main() {
  const built = readFileSync(MARKER, "utf8").trim();
  const latest = await latestBuild();
  const line = latest
    ? behindLine(built, latest, relationOf(built, latest))
    : "";

  if (line) {
    console.log(line);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {});
}
