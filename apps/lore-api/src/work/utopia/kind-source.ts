// The Utopia source a kind of mirrored thing is pushed to (specs/utopia-graph-mirror FR18): in the repo's knowledge base, the `docs`, `git-history` or `github` api source that takes whole text documents, or the `test-coverage` statements source, created the first time one is pushed to.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  utopiaAutoSetupConfigured,
  utopiaClientFrom,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type {
  DocumentMirrorDeps,
  MirrorDeps,
} from "@re-cinq/lore-shared/utopia/push-items.js";
import type { Pool } from "pg";
import {
  EXTRACTION_OFF_KINDS,
  kindSourceFor,
  saveKindSource,
  type KindSourceKey,
  type MirrorKind,
} from "../../outbound/utopia-kind-sources.js";
import { saveUtopiaDocsSourceId } from "../../outbound/utopia-sources.js";
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

  return kindSourceIn(pool, { repo, kind, kbId: kbId! }, env);
}

/** Pushes the statements of a kind to its source in the repo's knowledge base, or null when the repo has no knowledge base and the deployment cannot set one up, so there is nothing to mirror to. */
export async function kindMirrorDeps(
  pool: Pool,
  repo: string,
  kind: MirrorKind,
  env: UtopiaEnv = process.env,
): Promise<MirrorDeps | null> {
  const source = await kindSourceIfBase(pool, repo, kind, env);

  return (
    source && {
      push: (pushed) => utopiaClientFrom(env).pushStatements(source, pushed),
    }
  );
}

/** {@link kindMirrorDeps} for a kind whose source takes whole text documents. */
export async function kindDocumentDeps(
  pool: Pool,
  repo: string,
  kind: MirrorKind,
  env: UtopiaEnv = process.env,
): Promise<DocumentMirrorDeps | null> {
  const source = await kindSourceIfBase(pool, repo, kind, env);

  return (
    source && {
      push: (document) => utopiaClientFrom(env).pushDocument(source, document),
    }
  );
}

/** {@link kindDocumentDeps}, had on the first push, so a walk that finds nothing to push makes no source. */
export function lazyKindDocumentDeps(
  pool: Pool,
  repo: string,
  kind: MirrorKind,
  env: UtopiaEnv = process.env,
): DocumentMirrorDeps {
  let held: Promise<DocumentMirrorDeps | null> | undefined;

  return {
    push: async (document) => {
      held ??= kindDocumentDeps(pool, repo, kind, env);
      const deps = await held;

      enforceTrue(
        deps,
        Error,
        `${repo} has no Utopia knowledge base to mirror its ${kind} to`,
      );

      return deps!.push(document);
    },
  };
}

async function kindSourceIfBase(
  pool: Pool,
  repo: string,
  kind: MirrorKind,
  env: UtopiaEnv,
): Promise<UtopiaSource | null> {
  const kbId = await repoKnowledgeBase(pool, repo, env);

  return kbId ? kindSourceIn(pool, { repo, kind, kbId }, env) : null;
}

async function kindSourceIn(
  pool: Pool,
  wanted: KindSourceKey,
  env: UtopiaEnv,
): Promise<UtopiaSource> {
  const { repo, kind, kbId } = wanted;
  const stored = await kindSourceFor(pool, repo, kind);

  if (stored?.kbId === kbId) {
    return { id: stored.id, key: stored.key };
  }

  return sharedPerRepo(creating, `${repo}:${kind}`, () =>
    createKindSource(pool, wanted, env),
  );
}

async function createKindSource(
  pool: Pool,
  wanted: KindSourceKey,
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

  if (kind === "docs") {
    await saveUtopiaDocsSourceId(pool, repo, source.id);
  }

  return source;
}

/** The statements kind takes structured items, each name an identity Lore already knows to be unique (a path, a test title, a statement id), the others whole text documents. */
function newSource(
  session: ReturnType<typeof loreSession>,
  kbId: string,
  kind: MirrorKind,
): Promise<UtopiaSource> {
  return kind === "test-coverage"
    ? session.createStatementsSource(kbId, kind, { names: "identity" })
    : session.createApiSource(
        kbId,
        kind,
        EXTRACTION_OFF_KINDS.includes(kind) ? { extract: false } : {},
      );
}
