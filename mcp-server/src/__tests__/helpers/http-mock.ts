/**
 * Test harness for driving routes.ts through its public `handleApiRoute`
 * dispatcher. There is no `node-mocks-http` dependency, so we build the
 * minimal `IncomingMessage` / `ServerResponse` surface the handlers touch:
 * `readBody`/`readJsonBody` only need `req` to be a Readable that emits
 * `data`/`end`; `json()` only needs `res.writeHead(code, headers?)` to chain
 * into `.end(body)`.
 */
import { Readable } from "node:stream";
import { beforeEach, afterEach, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface MockReqInit {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Object bodies are JSON-stringified; strings pass through untouched
   *  (needed for raw HMAC bodies and URL-encoded Slack payloads). */
  body?: unknown;
}

export function makeReq(init: MockReqInit): IncomingMessage {
  const raw =
    init.body === undefined
      ? ""
      : typeof init.body === "string"
        ? init.body
        : JSON.stringify(init.body);
  const stream = Readable.from([Buffer.from(raw, "utf-8")]) as unknown as
    IncomingMessage & { url: string; method: string; headers: Record<string, string> };
  stream.url = init.url;
  stream.method = init.method ?? "GET";
  stream.headers = init.headers ?? {};
  return stream;
}

export interface MockRes extends ServerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  /** Parsed JSON body — throws if the body was not JSON. */
  readonly json: any;
}

export function makeRes(): MockRes {
  const res: any = {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      if (headers) Object.assign(this.headers, headers);
      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined && chunk !== null) this.body += String(chunk);
      this.ended = true;
      return this;
    },
    get json() {
      return JSON.parse(this.body);
    },
  };
  return res as MockRes;
}

/** A pg Pool mock — `query` is a vi.fn; `connect` returns a client mock. */
export function makePool() {
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

/** An Octokit mock with the rest endpoints routes.ts calls. */
export function makeOctokit() {
  return {
    rest: {
      repos: { listCommits: vi.fn() },
      pulls: { get: vi.fn() },
      git: { getCommit: vi.fn() },
    },
  };
}

/**
 * Keep the in-module rate-limit sliding window from tripping across a large
 * suite. `rateLimit` keys on `Date.now()`; faking only `Date` (not timers)
 * leaves mocked fetch/Octokit promises resolving normally. Each test jumps
 * 120s ahead so the previous test's 60s window is fully evicted, while time
 * stays frozen *within* a test so the dedicated 429 tests can pile calls into
 * one window.
 */
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
