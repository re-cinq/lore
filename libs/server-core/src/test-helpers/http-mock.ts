/** Test harness for routes.ts dispatcher with minimal IncomingMessage/ServerResponse surface. */
import { Readable } from "node:stream";
import { beforeEach, afterEach, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface MockReqInit {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Objects JSON-stringified; strings pass through (HMAC/URL-encoded payloads). */
  body?: unknown;
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

export interface MockRes extends ServerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  /** Parsed JSON body — throws if the body was not JSON. */
  readonly json: unknown;
}

export function makeRes(): MockRes {
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;

      if (headers) {
        Object.assign(this.headers, headers);
      }

      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined && chunk !== null) {
        this.body += String(chunk);
      }
      this.ended = true;

      return this;
    },
    get json() {
      return JSON.parse(this.body);
    },
  };

  return res as unknown as MockRes;
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
