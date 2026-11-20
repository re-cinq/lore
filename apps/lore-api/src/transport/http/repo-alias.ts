// A public mirror's name answers with its private repository (specs/public-mirror FR6): rewritten before the repo guard runs, so the guard checks the private name.

import type {
  Request,
  ResponseToolkit,
  RouteOptions,
  Server,
} from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  repoAt,
  repoDeclarationOf,
  repoLocationOf,
  type RepoLocation,
} from "./repo-guard.js";

const WRITABLE_KEY = "mirrorWritable";
const READ_METHODS = ["get", "head"];
const UNDECLARED_LOCATIONS: RepoLocation[] = [
  { from: "path" },
  { from: "query", name: "repo" },
  { from: "payload", name: "repo" },
];

export type MirrorOwnerOf = (name: string) => Promise<string | null>;
export type AliasDecision = "pass" | "rewrite" | "refuse";

/** Opt a route in to being written through the mirror's name; wrap the route's other `app` options, such as `repoLevel(...)`, so both survive. */
export function mirrorWritable(
  base: Pick<RouteOptions, "app"> = {},
): Pick<RouteOptions, "app"> {
  return { app: { ...(base.app as object), [WRITABLE_KEY]: true } };
}

/** A mirror's reads are answered with its private repository, its writes are refused unless the route opted in. */
export function aliasDecision(request: {
  method: string;
  writable: boolean;
  owner: string | null;
}): AliasDecision {
  if (request.owner === null) {
    return "pass";
  }

  return request.writable || READ_METHODS.includes(request.method)
    ? "rewrite"
    : "refuse";
}

interface CacheOptions {
  ttlMs: number;
  now: () => number;
}

const MAX_CACHED_NAMES = 500;

/** Remembers each name's answer for a while, so a server with no mirror asks the database once per repository per window, not once per request. */
export function cachedOwnerOf(
  ownerOf: MirrorOwnerOf,
  { ttlMs = 30_000, now = Date.now }: Partial<CacheOptions> = {},
): MirrorOwnerOf {
  const answers = new Map<string, { owner: string | null; until: number }>();

  return async (name) => {
    const key = name.toLowerCase();
    const held = answers.get(key);

    if (held && held.until > now()) {
      return held.owner;
    }
    const owner = await ownerOf(name);

    if (answers.size >= MAX_CACHED_NAMES) {
      answers.clear();
    }
    answers.set(key, { owner, until: now() + ttlMs });

    return owner;
  };
}

/** Register before the repo guard: a person who can open only the public repository must not reach the private one through its name. */
export function registerRepoAlias(
  server: Server,
  ownerOf: MirrorOwnerOf,
): void {
  server.ext("onPreHandler", async (request: Request, h: ResponseToolkit) => {
    await answerWithPrivateRepo(request, ownerOf);

    return h.continue;
  });
}

async function answerWithPrivateRepo(
  request: Request,
  ownerOf: MirrorOwnerOf,
): Promise<void> {
  const found = locate(request);
  const owner = found ? await ownerOf(found.name) : null;
  const decision = aliasDecision({
    method: request.method,
    writable: isMirrorWritable(request),
    owner,
  });

  enforceTrue(
    decision !== "refuse",
    apiError(409),
    `${found?.name} is the public mirror of ${owner}; use ${owner}`,
  );

  if (found && owner) {
    rewrite(request, found.location, owner);
  }
}

function isMirrorWritable(request: Request): boolean {
  const { settings } = request.route;
  const app = settings.app as Record<string, unknown> | undefined;

  return app?.[WRITABLE_KEY] === true;
}

interface FoundRepo {
  name: string;
  location: RepoLocation;
}

/** Records and routes spanning repositories are left alone; a route declaring nothing is read at its path, its `repo` query and its `repo` field. */
function locate(request: Request): FoundRepo | null {
  const locations = repoDeclarationOf(request)
    ? [repoLocationOf(request)]
    : UNDECLARED_LOCATIONS;

  return locations.reduce<FoundRepo | null>(
    (found, location) => found ?? foundAt(request, location),
    null,
  );
}

function foundAt(
  request: Request,
  location: RepoLocation | null,
): FoundRepo | null {
  const name = location ? repoAt(request, location) : null;

  return name && location ? { name, location } : null;
}

function rewrite(request: Request, location: RepoLocation, owner: string) {
  if (location.from === "path") {
    rewritePath(request, owner);

    return;
  }
  const holder = location.from === "query" ? "query" : "payload";
  const held = request[holder] as object;

  Object.assign(request, { [holder]: { ...held, [location.name]: owner } });
}

function rewritePath(request: Request, owner: string) {
  const [ownerName, repoName] = owner.split("/");

  enforceTrue(
    Boolean(ownerName && repoName),
    apiError(500),
    `mirror owner ${owner} is not owner/name`,
  );
  Object.assign(request.params, { owner: ownerName, repo: repoName });
}
