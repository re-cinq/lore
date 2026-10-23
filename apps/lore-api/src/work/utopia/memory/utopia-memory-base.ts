// Where a memory or an episode is mirrored to (specs/utopia-graph-mirror FR16): the knowledge base of the onboarded repo it belongs to, else the org's `<org>/memory` base, and in that base the `memories` or `episodes` api source, created the first time one is pushed to.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  utopiaAutoSetupConfigured,
  utopiaClientFrom,
  type DocumentPushOutcome,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { IngestDocument } from "@re-cinq/lore-shared/utopia/memory-documents.js";
import type { Pool } from "pg";
import { utopiaBaseFor } from "../../../outbound/utopia-sources.js";
import { onboardedRepo } from "../../../outbound/memory-rows.js";
import {
  memorySourceFor,
  saveMemorySource,
  type MemoryBase,
  type MemoryKind,
} from "../../../outbound/utopia-memory-sources.js";
import {
  autoSetUpRepo,
  loreSession,
  sharedPerRepo,
} from "../utopia-auto-setup.js";
import { repoKnowledgeBase } from "../repo-mirror.js";

/** Null on a deployment that names no org: its rows with no onboarded repo are not mirrored. */
export function orgMemoryBase(env: UtopiaEnv = process.env): MemoryBase | null {
  return env.GITHUB_ORG
    ? { name: `${env.GITHUB_ORG}/memory`, repo: false }
    : null;
}

export async function memoryBaseOf(
  pool: Pool,
  repo: string | null,
  env: UtopiaEnv,
): Promise<MemoryBase | null> {
  const held = repo ? await onboardedRepo(pool, repo) : null;

  return held ? { name: held, repo: true } : orgMemoryBase(env);
}

/** Pushes one document to the base's source of that kind; throws when the base or the source cannot be had, so the caller logs and counts it. */
export async function pushToBase(
  pool: Pool,
  base: MemoryBase,
  pushed: { kind: MemoryKind; document: IngestDocument },
  env: UtopiaEnv,
): Promise<DocumentPushOutcome> {
  const source = await memorySourceOf(pool, base, pushed.kind, env);

  return utopiaClientFrom(env).pushDocument(source, pushed.document);
}

/** A source and the walk's cursor in it: null for a source just created. */
export interface MemorySource extends UtopiaSource {
  cursor: string | null;
}

const creating = new Map<string, Promise<MemorySource>>();

/** The stored source while it belongs to the base's knowledge base; else a new one, which needs the deployment's write token. Two pushes of one base in this process share one creation. */
export async function memorySourceOf(
  pool: Pool,
  base: MemoryBase,
  kind: MemoryKind,
  env: UtopiaEnv,
): Promise<MemorySource> {
  const kbId = await knowledgeBaseOf(pool, base, env);

  enforceTrue(
    kbId,
    Error,
    `${base.name} has no Utopia knowledge base and this deployment cannot set one up`,
  );
  const stored = await memorySourceFor(pool, base.name, kind);

  if (stored?.kbId === kbId) {
    return { id: stored.id, key: stored.key, cursor: stored.cursor };
  }

  return sharedPerRepo(creating, `${base.name}:${kind}`, () =>
    createMemorySource(pool, { base, kind, kbId: kbId! }, env),
  );
}

async function createMemorySource(
  pool: Pool,
  wanted: { base: MemoryBase; kind: MemoryKind; kbId: string },
  env: UtopiaEnv,
): Promise<MemorySource> {
  const { base, kind, kbId } = wanted;

  enforceTrue(
    utopiaAutoSetupConfigured(env),
    Error,
    `${base.name} has no Utopia ${kind} source and this deployment cannot create one`,
  );
  const source = await loreSession(env).createApiSource(kbId, kind);
  const saved = { base: base.name, kind, kbId, sourceId: source.id };

  await saveMemorySource(pool, { ...saved, key: source.key });

  return { ...source, cursor: null };
}

/** A repo's base is the one its spec and ADR mirror pushes to; the org base is set up the same way, the first time one of its rows is pushed. */
function knowledgeBaseOf(
  pool: Pool,
  base: MemoryBase,
  env: UtopiaEnv,
): Promise<string | null> {
  return base.repo
    ? repoKnowledgeBase(pool, base.name, env)
    : orgKnowledgeBase(pool, base.name, env);
}

async function orgKnowledgeBase(
  pool: Pool,
  name: string,
  env: UtopiaEnv,
): Promise<string | null> {
  const kbId = await utopiaBaseFor(pool, name);

  if (kbId || !utopiaAutoSetupConfigured(env)) {
    return kbId;
  }

  return autoSetUpRepo(pool, name, env);
}
