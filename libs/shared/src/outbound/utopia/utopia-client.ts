// Utopia (deeplethe/utopia), the knowledge-graph service the spec→test→code chain is mirrored into: a per-source push surface and a person's surface for setting a repository's knowledge base up, reached with their session or their write token.

import { enforceTrue } from "../../lib/enforce.js";
import { wireBody, type PushItem } from "../../domain/utopia/statements.js";

export type UtopiaEnv = Partial<
  Record<"UTOPIA_API_URL" | "UTOPIA_TOKEN" | "UTOPIA_WORKSPACE_ID", string>
>;

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
  /** Acts as a person: `bearer` is their session JWT or a personal access token with `write` scope (`utp_pat_…`); Utopia answers both the same. */
  withCredential(bearer: string): UtopiaSession;
}

export interface UtopiaClientOptions {
  /** The wait before the one retry a 429 or 5xx gets. */
  retryDelayMs?: number;
  /** How long a push or a read waits for its answer. */
  requestTimeoutMs?: number;
  /** How long a heavy call, an ontology import, waits for its answer. */
  importTimeoutMs?: number;
}

export class UtopiaError extends Error {
  readonly status: number;
  /** The first 300 characters of what Utopia answered. */
  readonly body: string;

  constructor(status: number, body: string) {
    super(`utopia answered ${status}: ${body}`);
    this.name = "UtopiaError";
    this.status = status;
    this.body = body;
  }
}

/** False on a deployment that was given no Utopia, so the mirror stays off instead of failing every ingest. */
export function utopiaConfigured(env: UtopiaEnv = process.env): boolean {
  return Boolean(env.UTOPIA_API_URL);
}

/** True when the deployment holds a Utopia write token and the workspace to create bases in, so a repo's first ingest sets its knowledge base up without a person. */
export function utopiaAutoSetupConfigured(
  env: UtopiaEnv = process.env,
): boolean {
  return AUTO_SETUP_KEYS.every((key) => Boolean(env[key]));
}

const AUTO_SETUP_KEYS = [
  "UTOPIA_API_URL",
  "UTOPIA_TOKEN",
  "UTOPIA_WORKSPACE_ID",
] as const;

export function utopiaClientFrom(
  env: UtopiaEnv,
  options: UtopiaClientOptions = {},
): UtopiaClient {
  enforceTrue(
    env.UTOPIA_API_URL,
    Error,
    "UTOPIA_API_URL must be set to reach Utopia",
  );
  const request = utopiaRequester(env.UTOPIA_API_URL!, options);

  return {
    pushStatements: (source, pushed) =>
      request<PushOutcome>(`/sources/${source.id}/statements`, {
        token: source.key,
        json: wireBody(pushed),
      }),
    withCredential: (bearer) => sessionOf(request, bearer),
  };
}

let client: UtopiaClient | undefined;

export function utopiaClient(): UtopiaClient {
  client ??= utopiaClientFrom(process.env);

  return client;
}

/** Requests to the routes under `/api/v1` of the deployment's URL. */
export function utopiaRequester(
  apiUrl: string,
  options: UtopiaClientOptions,
): Requester {
  return requester(`${apiUrl.replace(/\/+$/, "")}/api/v1`, {
    retryDelayMs: options.retryDelayMs ?? 500,
    requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    importTimeoutMs: options.importTimeoutMs ?? IMPORT_TIMEOUT_MS,
  });
}

export interface RequestOptions {
  token: string;
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
  /** An ontology import plans against the whole base, writes every class and relation, and queues alignment: on a busy base it outlasts a push's wait by far. */
  heavy?: boolean;
}

export type Requester = <T>(
  path: string,
  options: RequestOptions,
) => Promise<T>;

const RETRY_STATUS = (status: number) => status === 429 || status >= 500;

const BODY_EXCERPT = 300;

const REQUEST_TIMEOUT_MS = 30_000;

const IMPORT_TIMEOUT_MS = 5 * 60_000;

interface RequesterTiming {
  retryDelayMs: number;
  requestTimeoutMs: number;
  importTimeoutMs: number;
}

/** A 429 or 5xx is retried once; any other refusal throws a `UtopiaError` at once. */
function requester(base: string, timing: RequesterTiming): Requester {
  return async <T>(path: string, options: RequestOptions): Promise<T> => {
    const timeoutMs = options.heavy
      ? timing.importTimeoutMs
      : timing.requestTimeoutMs;
    const call = () => send(`${base}${path}`, options, timeoutMs);
    const first = await call();
    const response = RETRY_STATUS(first.status)
      ? await retryAfter(timing.retryDelayMs, call)
      : first;

    enforceTrue(
      response.ok,
      () =>
        new UtopiaError(response.status, response.body.slice(0, BODY_EXCERPT)),
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

async function send(
  url: string,
  options: RequestOptions,
  timeoutMs: number,
): Promise<Answer> {
  const response = await fetch(url, {
    method: options.method ?? "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: headersOf(options),
    body: options.form ?? JSON.stringify(options.json),
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

function headersOf(options: RequestOptions): Record<string, string> {
  const json = options.json === undefined;

  return {
    authorization: `Bearer ${options.token}`,
    ...(json ? {} : { "content-type": "application/json" }),
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
  bearer: string;
}

function sessionOf(request: Requester, bearer: string): UtopiaSession {
  const call: SessionCall = { request, bearer };

  return {
    listKnowledgeBases: (workspaceId) =>
      request<KnowledgeBase[]>(`/workspaces/${workspaceId}/kbs`, {
        token: bearer,
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
  { request, bearer }: SessionCall,
  workspaceId: string,
  name: string,
): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`/workspaces/${workspaceId}/kbs`, {
    token: bearer,
    json: { name, kind: "knowledge", ontology_packs: [] },
  });
}

async function bindKindWord(
  { request, bearer }: SessionCall,
  kbId: string,
  word: string,
  classKey: string,
): Promise<void> {
  await request(`/kbs/${kbId}/review/alignment/kind-words/${word}`, {
    token: bearer,
    json: { class: classKey },
  });
}

async function importOntology(
  { request, bearer }: SessionCall,
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
    { token: bearer, form, heavy: true },
  );

  return { importId: imported.import_id };
}

async function createStatementsSource(
  { request, bearer }: SessionCall,
  kbId: string,
  name: string,
): Promise<UtopiaSource> {
  const created = await request<{
    ingest_token: string;
    source: { id: string };
  }>(`/kbs/${kbId}/sources`, {
    token: bearer,
    json: { kind: "statements", name, config: {} },
  });

  return { id: created.source.id, key: created.ingest_token };
}
