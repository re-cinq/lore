/** Test harness for routes.ts dispatcher with minimal IncomingMessage/ServerResponse surface. */
import { Readable } from "node:stream";
import { beforeEach, afterEach, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Mock } from "vitest";

export interface MockReqInit {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Objects JSON-stringified; strings pass through (HMAC/URL-encoded payloads). */
  body?: unknown;
}

export function makeReq(init: MockReqInit): IncomingMessage {
  const raw = rawRequestBody(init.body);
  const stream = Readable.from([
    Buffer.from(raw, "utf-8"),
  ]) as unknown as IncomingMessage & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };

  stream.url = init.url;
  stream.method = init.method ?? "GET";
  stream.headers = init.headers ?? {};

  return stream;
}

function rawRequestBody(body: unknown): string {
  if (body === undefined) {
    return "";
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
}

export interface MockRes extends ServerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  /** Parsed JSON body — throws if the body was not JSON. */
  readonly json: unknown;
}

// The mutable half of the mock — what the two methods below read and write through `this`.
interface MockResState {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

export function makeRes(): MockRes {
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
    writeHead,
    end,
    get json() {
      return JSON.parse(this.body);
    },
  };

  return res as unknown as MockRes;
}

// Records the status and merges headers, exactly as ServerResponse does — a second writeHead adds to the headers rather than replacing them.
function writeHead(
  this: MockResState,
  code: number,
  headers?: Record<string, string>,
) {
  this.statusCode = code;

  if (headers) {
    Object.assign(this.headers, headers);
  }

  return this;
}

// Appends the chunk and marks the response finished. A null or undefined chunk ends the response without writing "null" into the body.
function end(this: MockResState, chunk?: unknown) {
  if (chunk !== undefined && chunk !== null) {
    this.body += String(chunk);
  }
  this.ended = true;

  return this;
}

export interface MockPoolClient {
  query: Mock;
  release: Mock;
}

export interface MockPool {
  query: Mock;
  connect: Mock;
  __client: MockPoolClient;
}

/** A pg Pool mock — `query` is a vi.fn; `connect` returns a client mock. */
export function makePool(): MockPool {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(client),
    __client: client,
  };

  return pool;
}

export interface MockOctokit {
  rest: {
    repos: { listCommits: Mock };
    pulls: { get: Mock };
    git: { getCommit: Mock };
  };
}

/** An Octokit mock with the rest endpoints routes.ts calls. */
export function makeOctokit(): MockOctokit {
  return {
    rest: {
      repos: { listCommits: vi.fn() },
      pulls: { get: vi.fn() },
      git: { getCommit: vi.fn() },
    },
  };
}

/** Keeps rate-limit window from tripping; fakes Date.now() to jump 120s between tests. */
let clockTick = 0;
const CLOCK_BASE = 1_700_000_000_000;

export function useRateLimitSafeClock(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CLOCK_BASE + clockTick++ * 120_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** Standard auth: the legacy full-access token. Tests send `Bearer test-token`. */
export const LEGACY_TOKEN = "test-token";
export const AUTH = { authorization: `Bearer ${LEGACY_TOKEN}` };
