/** GitHub webhook management via Lore GitHub App; ensureRepoWebhook is idempotent (create/repoint/update + ping). */

import { getOctokit } from "../../platform/github-client.js";
import type { RepoHook } from "./webhook-status.js";

function ownerRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

export async function listRepoWebhooks(repo: string): Promise<RepoHook[]> {
  const octokit = await getOctokit();
  const [owner, name] = ownerRepo(repo);
  const { data: hooks } = await octokit.rest.repos.listWebhooks({
    owner,
    repo: name,
    per_page: 100,
  });

  return hooks as unknown as RepoHook[];
}

export async function ensureRepoWebhook(
  repo: string,
  url: string,
  secret: string,
  events: string[],
): Promise<{ hookId: number; created: boolean }> {
  const octokit = await getOctokit();
  const [owner, name] = ownerRepo(repo);
  const config = { url, content_type: "json", secret };

  const { data: hooks } = await octokit.rest.repos.listWebhooks({
    owner,
    repo: name,
    per_page: 100,
  });
  const existing = hooks.find((h) =>
    (h.config.url ?? "").endsWith("/api/webhook/github"),
  );

  if (existing) {
    await octokit.rest.repos.updateWebhook({
      owner,
      repo: name,
      hook_id: existing.id,
      config,
      events,
      active: true,
    });
    await octokit.rest.repos
      .pingWebhook({ owner, repo: name, hook_id: existing.id })
      .catch(() => {});

    return { hookId: existing.id, created: false };
  }

  const { data: created } = await octokit.rest.repos.createWebhook({
    owner,
    repo: name,
    name: "web",
    config,
    events,
    active: true,
  });

  await octokit.rest.repos
    .pingWebhook({ owner, repo: name, hook_id: created.id })
    .catch(() => {});

  return { hookId: created.id, created: true };
}
