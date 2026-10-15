// Utopia (deeplethe/utopia), the knowledge-graph service the spec→test→code chain is mirrored into: a per-source push surface and a person's session surface for setting a repository's knowledge base up.

import { enforceTrue } from "../../lib/enforce.js";
import { wireBody, type PushItem } from "../../domain/utopia/statements.js";

export type UtopiaEnv = Partial<Record<"UTOPIA_API_URL", string>>;

export interface UtopiaSource {
  id: string;
  /** The source's own ingest token (`utp_…`): it can push to this source and nothing else. */
  key: string;
}

export type PushAction = "created" | "updated" | "unchanged" | "marked_missing";

export interface PushOutcome {
  action: PushAction;
}

export interface KnowledgeBase {
  id: string;
  name: string;
}

export interface UtopiaSession {
  listKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]>;
  createKnowledgeBase(
    workspaceId: string,
    name: string,
  ): Promise<KnowledgeBase>;
  importOntology(
    kbId: string,
    turtle: string,
    filename: string,
  ): Promise<{ importId: string }>;
  bindKindWord(kbId: string, word: string, classKey: string): Promise<void>;
  createStatementsSource(kbId: string, name: string): Promise<UtopiaSource>;
}

export interface UtopiaClient {
  pushStatements(source: UtopiaSource, pushed: PushItem): Promise<PushOutcome>;
  withSession(jwt: string): UtopiaSession;
}

export interface UtopiaClientOptions {
  /** The wait before the one retry a 429 or 5xx gets. */
  retryDelayMs?: number;
}

export class UtopiaPushError extends Error {
  readonly status: number;
  /** The first 300 characters of what Utopia answered. */
  readonly body: string;

  constructor(status: number, body: string) {
    super(`utopia answered ${status}: ${body}`);
    this.name = "UtopiaPushError";
    this.status = status;
    this.body = body;
  }
}

/** False on a deployment that was given no Utopia, so the mirror stays off instead of failing every ingest. */
export function utopiaConfigured(env: UtopiaEnv = process.env): boolean {
  return Boolean(env.UTOPIA_API_URL);
}

export function utopiaClientFrom(
  env: UtopiaEnv,
  options: UtopiaClientOptions = {},
): UtopiaClient {
  enforceTrue(
    env.UTOPIA_API_URL,
    Error,
    "UTOPIA_API_URL must be set to reach Utopia",
  );
  const base = `${env.UTOPIA_API_URL!.replace(/\/+$/, "")}/api/v1`;
  const request = requester(base, options.retryDelayMs ?? 500);

  return {
    pushStatements: (source, pushed) =>
      request<PushOutcome>(`/sources/${source.id}/statements`, {
        token: source.key,
        json: wireBody(pushed),
      }),
    withSession: (jwt) => sessionOf(request, jwt),
  };
}

let client: UtopiaClient | undefined;

export function utopiaClient(): UtopiaClient {
  client ??= utopiaClientFrom(process.env);

  return client;
}

interface RequestOptions {
  token: string;
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
}

type Requester = <T>(path: string, options: RequestOptions) => Promise<T>;

const RETRY_STATUS = (status: number) => status === 429 || status >= 500;

const BODY_EXCERPT = 300;

const REQUEST_TIMEOUT_MS = 30_000;

function requester(base: string, retryDelayMs: number): Requester {
  return async <T>(path: string, options: RequestOptions): Promise<T> => {
    const first = await send(`${base}${path}`, options);
    const response = RETRY_STATUS(first.status)
      ? await retryAfter(retryDelayMs, () => send(`${base}${path}`, options))
      : first;

    enforceTrue(
      response.ok,
      () =>
        new UtopiaPushError(
          response.status,
          response.body.slice(0, BODY_EXCERPT),
        ),
      "",
    );

    return JSON.parse(response.body) as T;
  };
}

interface Answer {
  ok: boolean;
  status: number;
  body: string;
}

async function send(url: string, options: RequestOptions): Promise<Answer> {
  const response = await fetch(url, {
    method: options.method ?? "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(options.json === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: options.form ?? JSON.stringify(options.json),
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

async function retryAfter(
  delayMs: number,
  again: () => Promise<Answer>,
): Promise<Answer> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return again();
}

interface SessionCall {
  request: Requester;
  jwt: string;
}

function sessionOf(request: Requester, jwt: string): UtopiaSession {
  const call: SessionCall = { request, jwt };

  return {
    listKnowledgeBases: (workspaceId) =>
      request<KnowledgeBase[]>(`/workspaces/${workspaceId}/kbs`, {
        token: jwt,
        method: "GET",
      }),
    createKnowledgeBase: (workspaceId, name) =>
      createKnowledgeBase(call, workspaceId, name),
    importOntology: (kbId, turtle, filename) =>
      importOntology(call, kbId, { turtle, filename }),
    bindKindWord: (kbId, word, classKey) =>
      bindKindWord(call, kbId, word, classKey),
    createStatementsSource: (kbId, name) =>
      createStatementsSource(call, kbId, name),
  };
}

function createKnowledgeBase(
  { request, jwt }: SessionCall,
  workspaceId: string,
  name: string,
): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`/workspaces/${workspaceId}/kbs`, {
    token: jwt,
    json: { name, kind: "knowledge", ontology_packs: [] },
  });
}

async function bindKindWord(
  { request, jwt }: SessionCall,
  kbId: string,
  word: string,
  classKey: string,
): Promise<void> {
  await request(`/kbs/${kbId}/review/alignment/kind-words/${word}`, {
    token: jwt,
    json: { class: classKey },
  });
}

async function importOntology(
  { request, jwt }: SessionCall,
  kbId: string,
  file: { turtle: string; filename: string },
): Promise<{ importId: string }> {
  const form = new FormData();

  form.append(
    "file",
    new Blob([file.turtle], { type: "text/turtle" }),
    file.filename,
  );
  const imported = await request<{ import_id: string }>(
    `/kbs/${kbId}/ontology/imports`,
    { token: jwt, form },
  );

  return { importId: imported.import_id };
}

async function createStatementsSource(
  { request, jwt }: SessionCall,
  kbId: string,
  name: string,
): Promise<UtopiaSource> {
  const created = await request<{
    ingest_token: string;
    source: { id: string };
  }>(`/kbs/${kbId}/sources`, {
    token: jwt,
    json: { kind: "statements", name, config: {} },
  });

  return { id: created.source.id, key: created.ingest_token };
}
