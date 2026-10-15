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

export function postBackfill(
  target: LoreApiTarget,
  repo: string,
): Promise<BackfillAnswer> {
  const url = new URL(`${target.baseUrl}/api/repos/${repo}/utopia/backfill`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const req = send(url, {
    method: "POST",
    headers: bearerJsonHeaders(target.token),
    timeout: target.timeoutMs,
  });

  req.on("timeout", () =>
    req.destroy(new Error(`no answer within ${target.timeoutMs}ms`)),
  );

  return answerTo(req);
}

function answerTo(req: ClientRequest): Promise<BackfillAnswer> {
  return new Promise((resolve, reject) => {
    req.on("response", (res) => {
      readAnswer(res).then(resolve, reject);
    });
    req.on("error", reject);
    req.end();
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
