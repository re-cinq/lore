/** GitHub webhook management via Lore GitHub App; ensureRepoWebhook is idempotent (create/repoint/update + ping). */

import { getOctokit } from "../../outbound/github-client.js";
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

/** Points an existing hook at this deployment. The config is REPLACED, secret included: a repo whose hook still carries a rotated secret would keep delivering events that fail verification. */
async function updateHook(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  target: { owner: string; name: string },
  hookId: number,
  spec: { config: object; events: string[] },
): Promise<number> {
  await octokit.rest.repos.updateWebhook({
    owner: target.owner,
    repo: target.name,
    hook_id: hookId,
    config: spec.config,
    events: spec.events,
    active: true,
  });

  return hookId;
}

/** Creates the hook. `active: true` from the start — a hook created inactive looks configured and delivers nothing. */
async function createHook(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  target: { owner: string; name: string },
  spec: { config: object; events: string[] },
): Promise<number> {
  const { data: created } = await octokit.rest.repos.createWebhook({
    owner: target.owner,
    repo: target.name,
    name: "web",
    config: spec.config,
    events: spec.events,
    active: true,
  });

  return created.id;
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

  const hookId = existing
    ? await updateHook(octokit, { owner, name }, existing.id, {
        config,
        events,
      })
    : await createHook(octokit, { owner, name }, { config, events });

  // Pinged so a misconfigured secret shows up NOW, in the delivery log, rather than on the first real event. Swallowed: the hook exists either way.
  await octokit.rest.repos
    .pingWebhook({ owner, repo: name, hook_id: hookId })
    .catch(() => {});

  return { hookId, created: !existing };
}
