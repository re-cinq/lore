import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

export const API = "https://lore-api.example.com";

const THROWS = -1;

type Answers = Map<string, { status: number; body?: unknown }>;

/** A Lore API that answers by path; any path it was not given answers 404. */
export function fakeLoreApi() {
  const answers: Answers = new Map();
  const requested: string[] = [];

  beforeEach(() => {
    answers.clear();
    requested.length = 0;
    stubLoreEnv(answeringFetch(answers, requested));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  return {
    requested,
    answer: (path: string, body: unknown, status = 200) =>
      answers.set(path, { status, body }),
    refuse: (path: string, status: number) => answers.set(path, { status }),
    drop: (path: string) => answers.set(path, { status: THROWS }),
  };
}

function answeringFetch(answers: Answers, requested: string[]) {
  return async (url: string) => {
    const path = url.slice(API.length);
    const answer = answers.get(path) ?? { status: 404 };

    requested.push(path);

    enforceTrue(answer.status !== THROWS, Error, "connect ECONNREFUSED");

    return {
      ok: answer.status < 400,
      status: answer.status,
      statusText: answer.status === 404 ? "Not Found" : "Error",
      json: async () => answer.body,
    };
  };
}

function stubLoreEnv(fetchFake: (url: string) => Promise<unknown>) {
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
