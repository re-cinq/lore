// node:http, not fetch: fetch gives up on a response whose headers take more than five minutes, and lore-api answers a big repo's backfill only once every document is in.

import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { bearerJsonHeaders } from "@re-cinq/lore-shared/project/lib/http-auth.js";
import type { BackfillAnswer } from "./utopia-backfill-tick.js";

export interface LoreApiTarget {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
}

const HALF_AN_HOUR_MS = 30 * 60_000;

/** lore-api as this service reaches it, with the stations' own token; null on a deployment that names no lore-api. */
export function loreApiTarget(
  env: NodeJS.ProcessEnv = process.env,
): LoreApiTarget | null {
  const baseUrl = env.LORE_API_URL;

  return baseUrl
    ? {
        baseUrl,
        token: env.LORE_STATION_TOKEN ?? env.LORE_INGEST_TOKEN,
        timeoutMs: HALF_AN_HOUR_MS,
      }
    : null;
}

export function postBackfill(
  target: LoreApiTarget,
  repo: string,
): Promise<BackfillAnswer> {
  return postLoreApi(target, `/api/repos/${repo}/utopia/backfill`);
}

/** The commit walk of one repo's default branch, for the branch a push named: lore-api skips any other branch itself. */
export function postUtopiaCommits(
  target: LoreApiTarget,
  repo: string,
  branch: string,
): Promise<BackfillAnswer> {
  return postLoreApi(target, `/api/repos/${repo}/utopia/commits`, { branch });
}

/** The tracker walk of one repo: the issues and pull requests updated since the cursor lore-api holds. */
export function postUtopiaTracker(
  target: LoreApiTarget,
  repo: string,
): Promise<BackfillAnswer> {
  return postLoreApi(target, `/api/repos/${repo}/utopia/tracker`);
}

/** The push of one repo's tags and published releases. */
export function postUtopiaReleases(
  target: LoreApiTarget,
  repo: string,
): Promise<BackfillAnswer> {
  return postLoreApi(target, `/api/repos/${repo}/utopia/releases`);
}

function postLoreApi(
  target: LoreApiTarget,
  path: string,
  body?: Record<string, unknown>,
): Promise<BackfillAnswer> {
  const url = new URL(`${target.baseUrl}${path}`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const req = send(url, {
    method: "POST",
    headers: bearerJsonHeaders(target.token),
    timeout: target.timeoutMs,
  });

  req.on("timeout", () =>
    req.destroy(new Error(`no answer within ${target.timeoutMs}ms`)),
  );

  return answerTo(req, body === undefined ? undefined : JSON.stringify(body));
}

function answerTo(
  req: ClientRequest,
  body: string | undefined,
): Promise<BackfillAnswer> {
  return new Promise((resolve, reject) => {
    req.on("response", (res) => {
      readAnswer(res).then(resolve, reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function readAnswer(res: IncomingMessage): Promise<BackfillAnswer> {
  const chunks: Buffer[] = [];

  for await (const chunk of res) {
    chunks.push(chunk as Buffer);
  }

  return {
    status: res.statusCode ?? 0,
    body: Buffer.concat(chunks).toString("utf8"),
  };
}
