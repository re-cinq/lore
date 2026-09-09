/** GitHub webhook management via Lore GitHub App; ensureRepoWebhook is idempotent (create/repoint/update + ping). */

import { getOctokit } from "../../outbound/github-client.js";
import { isLoreHook, type RepoHook } from "./webhook-status.js";

type ReposApi = Awaited<ReturnType<typeof getOctokit>>["rest"]["repos"];

export async function listRepoWebhooks(repo: string): Promise<RepoHook[]> {
  const repos = await reposApi();
  const [owner, name] = ownerRepo(repo);
  const { data: hooks } = await repos.listWebhooks({
    owner,
    repo: name,
    per_page: 100,
  });

  return hooks as unknown as RepoHook[];
}

async function reposApi(): Promise<ReposApi> {
  const { rest } = await getOctokit();

  return rest.repos;
}

function ownerRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

export async function ensureRepoWebhook(
  repo: string,
  url: string,
  secret: string,
  events: string[],
): Promise<{ hookId: number; created: boolean }> {
  const repos = await reposApi();
  const [owner, name] = ownerRepo(repo);
  const target = { owner, name };
  const spec = { config: { url, content_type: "json", secret }, events };
  const existing = await findLoreHook(repos, target);
  const hookId = existing
    ? await updateHook(repos, target, existing.id, spec)
    : await createHook(repos, target, spec);

  await pingHook(repos, target, hookId);

  return { hookId, created: !existing };
}

/** Matched on the Lore delivery paths rather than a stored id, so a hook an earlier deployment left pointing at another host is repointed instead of duplicated. */
async function findLoreHook(
  repos: ReposApi,
  target: { owner: string; name: string },
) {
  const { data: hooks } = await repos.listWebhooks({
    owner: target.owner,
    repo: target.name,
    per_page: 100,
  });

  return hooks.find(isLoreHook);
}

/** Points an existing hook at this deployment. The config is REPLACED, secret included: a repo whose hook still carries a rotated secret would keep delivering events that fail verification. */
async function updateHook(
  repos: ReposApi,
  target: { owner: string; name: string },
  hookId: number,
  spec: { config: object; events: string[] },
): Promise<number> {
  await repos.updateWebhook({
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
  repos: ReposApi,
  target: { owner: string; name: string },
  spec: { config: object; events: string[] },
): Promise<number> {
  const { data: created } = await repos.createWebhook({
    owner: target.owner,
    repo: target.name,
    name: "web",
    config: spec.config,
    events: spec.events,
    active: true,
  });

  return created.id;
}

/** Pinged so a misconfigured secret shows up NOW, in the delivery log, rather than on the first real event. Swallowed: the hook exists either way. */
async function pingHook(
  repos: ReposApi,
  target: { owner: string; name: string },
  hookId: number,
): Promise<void> {
  await repos
    .pingWebhook({ owner: target.owner, repo: target.name, hook_id: hookId })
    .catch(() => {});
}
