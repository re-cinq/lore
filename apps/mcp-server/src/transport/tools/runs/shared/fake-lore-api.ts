import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

export const API = "https://lore-api.example.com";

const THROWS = -1;

type Answer = { status: number; body?: unknown };
type Init = { method?: string; body?: string };
type Calls = { requested: string[]; posted: { path: string; body: unknown }[] };

/** A Lore API that answers by "METHOD path" or by path; any other path answers 404. */
export function fakeLoreApi() {
  const answers = new Map<string, Answer>();
  const calls: Calls = { requested: [], posted: [] };

  beforeEach(() => {
    answers.clear();
    calls.requested.length = 0;
    calls.posted.length = 0;
    stubLoreEnv((url, init) =>
      answerFor(answers, record(calls, url, init), init),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  return controls(answers, calls);
}

function controls(answers: Map<string, Answer>, calls: Calls) {
  return {
    ...calls,
    answer: (key: string, body: unknown, status = 200) =>
      answers.set(key, { status, body }),
    refuse: (key: string, status: number) => answers.set(key, { status }),
    drop: (key: string) => answers.set(key, { status: THROWS }),
  };
}

function record(calls: Calls, url: string, init?: Init): string {
  const path = url.slice(API.length);

  calls.requested.push(path);

  if (init?.method === "POST") {
    calls.posted.push({ path, body: JSON.parse(init.body ?? "null") });
  }

  return path;
}

async function answerFor(
  answers: Map<string, Answer>,
  path: string,
  init?: Init,
) {
  const answer = answers.get(`${init?.method ?? "GET"} ${path}`) ??
    answers.get(path) ?? { status: 404 };

  enforceTrue(answer.status !== THROWS, Error, "connect ECONNREFUSED");

  return {
    ok: answer.status < 400,
    status: answer.status,
    statusText: answer.status === 404 ? "Not Found" : "Error",
    json: async () =>
      answer.body === undefined && answer.status >= 400
        ? Promise.reject(new SyntaxError("no body"))
        : answer.body,
  };
}

function stubLoreEnv(
  fetchFake: (url: string, init?: Init) => Promise<unknown>,
) {
  vi.stubGlobal("fetch", fetchFake);
  vi.stubEnv("LORE_API_URL", API);
  vi.stubEnv("LORE_INGEST_TOKEN", "tok");
  vi.stubEnv("LORE_CACHE_ENABLED", "false");
}

export function specDescription(tool: string): string | undefined {
  const spec = readFileSync(
    new URL(
      `../../../../../../../specs/mcp-tools/${tool}/spec.md`,
      import.meta.url,
    ),
    "utf-8",
  );

  return /\*\*description\*\* \(verbatim\):\n\n```text\n([\s\S]*?)\n```/.exec(
    spec,
  )?.[1];
}
