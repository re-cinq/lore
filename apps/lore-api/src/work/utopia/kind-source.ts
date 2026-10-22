// The Utopia source a kind of mirrored thing is pushed to (specs/utopia-graph-mirror FR18): in the repo's knowledge base, the `docs`, `git-history` or `github` api source that takes whole text documents, or the `test-coverage` statements source, created the first time one is pushed to.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  utopiaAutoSetupConfigured,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import {
  kindSourceFor,
  saveKindSource,
  type MirrorKind,
} from "../../outbound/utopia-kind-sources.js";
import { loreSession, sharedPerRepo } from "./utopia-auto-setup.js";
import { repoKnowledgeBase } from "./repo-mirror.js";

const creating = new Map<string, Promise<UtopiaSource>>();

/** The stored source while it belongs to the repo's knowledge base; else a new one, which needs the deployment's write token. Two pushes of one repo and kind in this process share one creation. */
export async function kindSourceOf(
  pool: Pool,
  repo: string,
  kind: MirrorKind,
  env: UtopiaEnv = process.env,
): Promise<UtopiaSource> {
  const kbId = await repoKnowledgeBase(pool, repo, env);

  enforceTrue(
    kbId,
    Error,
    `${repo} has no Utopia knowledge base and this deployment cannot set one up`,
  );
  const stored = await kindSourceFor(pool, repo, kind);

  if (stored?.kbId === kbId) {
    return { id: stored.id, key: stored.key };
  }

  return sharedPerRepo(creating, `${repo}:${kind}`, () =>
    createKindSource(pool, { repo, kind, kbId: kbId! }, env),
  );
}

async function createKindSource(
  pool: Pool,
  wanted: { repo: string; kind: MirrorKind; kbId: string },
  env: UtopiaEnv,
): Promise<UtopiaSource> {
  const { repo, kind, kbId } = wanted;

  enforceTrue(
    utopiaAutoSetupConfigured(env),
    Error,
    `${repo} has no Utopia ${kind} source and this deployment cannot create one`,
  );
  const source = await newSource(loreSession(env), kbId, kind);

  await saveKindSource(pool, wanted, source);

  return source;
}

/** The statements kind takes structured items, the others whole text documents. */
function newSource(
  session: ReturnType<typeof loreSession>,
  kbId: string,
  kind: MirrorKind,
): Promise<UtopiaSource> {
  return kind === "test-coverage"
    ? session.createStatementsSource(kbId, kind)
    : session.createApiSource(kbId, kind);
}
