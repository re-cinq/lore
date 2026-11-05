// What the context builder (backend lore-v2) reads through in lore-api: the repository's files and issues on GitHub, Lore's template assembly for each question and Lore's memory search for earlier work, on the model named for the `context` use.

import type { Pool } from "pg";
import type { Project } from "@re-cinq/lore-shared";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import type { LlmProvider } from "@re-cinq/lore-shared/llm/llm-provider.js";
import {
  CONTEXT_MODEL_KEY,
  CONTEXT_PROVIDER_KEY,
  contextModelOf,
} from "@re-cinq/lore-shared/context-model.js";
import { searchMemories } from "@re-cinq/lore-shared/project/knowledge/memory-search.js";
import {
  buildContext,
  type ContextBuilderDeps,
} from "@re-cinq/lore-shared/context-builder/build-context.js";
import {
  PRIMER_DOCUMENTS,
  writePrimer,
} from "@re-cinq/lore-shared/context-builder/repo-primer.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  assemblyScope,
  templateAssembly,
  type AssemblyScope,
} from "./template-assembly.js";
import { previousWorkLines } from "./previous-work.js";
import { primerCache } from "./primer-cache.js";
import { relatedRepos } from "./related-repos.js";

export interface BuilderRequest {
  repo: string;
  query: string;
  maxTokens: number;
  agentId?: string;
  crossRepoRequested: boolean;
}

/** One builder request and the repository scope it reads in. */
interface Asked {
  request: BuilderRequest;
  scope: AssemblyScope;
}

/** A builder request and the model it writes with. */
interface Building {
  request: BuilderRequest;
  llm: LlmProvider;
}

const USE = "context";
const REGISTRY_TIMEOUT_MS = 5_000;
const MAX_MANIFESTS = 20;
const MEMORY_LIMIT = 6;
const MAX_ISSUE_CHARS = 3_000;
const STORE = "lore";

const primerAt = primerCache();

/** The builder for a request, on the model the Settings page names (else the `LORE_CONTEXT_LLM_*` env, else Vertex gemini-3-flash-preview); null when the page says off or the request names no repository: then the template assembly answers. */
export async function contextBuilderFor(
  pool: Pool,
  request: BuilderRequest,
): Promise<(() => Promise<string>) | null> {
  const named = request.repo
    ? contextModelOf(await savedContextModel(pool), process.env)
    : null;

  if (!named) {
    return null;
  }
  const llm = Llm.forModel(USE, named);

  return async () => {
    const deps = await builderDeps(pool, { request, llm });
    const built = await buildContext(request, deps);

    console.log(`[context] builder stages ${stageLine(built.stages)}`);

    return built.text;
  };
}

function stageLine(stages: Record<string, number>): string {
  return Object.entries(stages)
    .map(([stage, ms]) => `${stage}=${ms}ms`)
    .join(" ");
}

async function savedContextModel(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM lore.settings WHERE key = ANY($1)`,
    [[CONTEXT_PROVIDER_KEY, CONTEXT_MODEL_KEY]],
  );

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function builderDeps(
  pool: Pool,
  { request, llm }: Building,
): Promise<ContextBuilderDeps> {
  const [project, scope] = await Promise.all([
    projectFor(request.repo),
    assemblyScope(pool, request.repo, STORE),
  ]);
  const tree = once(() => project.repo.tree());

  return {
    llm,
    primer: () => primerOf(request.repo, { project, llm }),
    tree,
    ...repoReads(project),
    answer: (question, repo) => answerText(pool, question, { repo, request }),
    issue: (number) => issueText(project, number),
    previousWork: (terms) => previousWork(pool, request, terms),
    relatedRepos: () => relatedFor(pool, { request, scope }, tree),
  };
}

function repoReads(
  project: Project,
): Pick<ContextBuilderDeps, "readFile" | "grep"> {
  return {
    readFile: (path) => project.repo.read(path),
    grep: (term) => project.repo.search(term),
  };
}

async function primerOf(
  repo: string,
  { project, llm }: { project: Project; llm: LlmProvider },
): Promise<string> {
  return primerAt(repo, await headOf(project), () =>
    writtenPrimer(project, llm),
  );
}

async function writtenPrimer(
  project: Project,
  llm: LlmProvider,
): Promise<string> {
  const documents = await Promise.all(
    PRIMER_DOCUMENTS.map(async (name) => ({
      name,
      text: await project.repo.read(name),
    })),
  );
  const present = documents.filter(
    (doc): doc is { name: string; text: string } => doc.text !== null,
  );

  return writePrimer(llm, {
    documents: present,
    tree: present.length === 0 ? await project.repo.tree() : [],
  });
}

async function headOf(project: Project): Promise<string> {
  return project.repo.headSha(await project.repo.defaultBranch());
}

async function answerText(
  pool: Pool,
  question: string,
  { repo, request }: { repo: string; request: BuilderRequest },
): Promise<string> {
  const scope = await assemblyScope(pool, repo, STORE);
  const assembled = await templateAssembly(pool, question, {
    ...scope,
    repo,
    agentId: request.agentId,
    crossRepoRequested: false,
  });

  return assembled.text;
}

async function issueText(
  project: Project,
  number: number,
): Promise<string | null> {
  const issue = await project.issues.get(number);

  return issue
    ? `#${issue.number} ${issue.title} (${issue.state})\n${(issue.body ?? "").slice(0, MAX_ISSUE_CHARS)}`
    : null;
}

async function previousWork(
  pool: Pool,
  request: BuilderRequest,
  terms: string[],
): Promise<string[]> {
  const memories = await searchMemories(
    pool,
    terms.join(" ") || request.query,
    { agentId: request.agentId, limit: MEMORY_LIMIT },
  );

  return previousWorkLines(memories);
}

async function relatedFor(
  pool: Pool,
  { request, scope }: Asked,
  tree: () => Promise<string[]>,
): Promise<string[]> {
  const project = await projectFor(request.repo);
  const crossRepo = request.crossRepoRequested || scope.settings.crossRepo;

  return relatedRepos(request.repo, {
    manifests: async () => manifestsOf(project, await tree()),
    registryRepository,
    onboarded: () => onboardedRepos(pool),
    linked: crossRepo ? (scope.settings.linkedRepos ?? []) : [],
  });
}

async function manifestsOf(
  project: Project,
  tree: string[],
): Promise<string[]> {
  const manifests = tree
    .filter(
      (path) =>
        path.endsWith("package.json") && !path.includes("node_modules/"),
    )
    .slice(0, MAX_MANIFESTS);
  const texts = await Promise.all(
    manifests.map((path) => project.repo.read(path)),
  );

  return texts.filter((text): text is string => text !== null);
}

/** The `repository` field the npm registry publishes for a package; null when the registry does not answer. */
async function registryRepository(packageName: string): Promise<string | null> {
  const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  }).catch(() => null);
  const body = response?.ok
    ? ((await response.json().catch(() => ({}))) as { repository?: unknown })
    : {};
  const repository = body.repository;

  return typeof repository === "string"
    ? repository
    : ((repository as { url?: string } | undefined)?.url ?? null);
}

async function onboardedRepos(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ full_name: string }>(
    `SELECT full_name FROM lore.repos`,
  );

  return rows.map((row) => row.full_name);
}

function once<T>(read: () => Promise<T>): () => Promise<T> {
  let held: Promise<T> | null = null;

  return () => (held ??= read());
}
