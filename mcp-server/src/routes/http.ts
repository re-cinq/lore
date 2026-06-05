/**
 * Shared HTTP plumbing for the route handlers — response writing and
 * request-body reading. No domain logic lives here.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

/**
 * Shared guard for the per-commit projection routes (`/coverage`,
 * `/test-report`): a non-empty `commit` is mandatory. Writes the 400 and
 * returns false when absent so the one error string has a single home.
 */
export function requireCommit(body: { commit?: string }, res: ServerResponse): boolean {
  if (typeof body.commit === "string" && body.commit.length > 0) return true;
  json(res, 400, { error: "required: commit" });
  return false;
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let len = 0;
    req.on("data", (chunk: Buffer) => {
      len += chunk.length;
      if (len > 1_048_576) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      buf += chunk.toString("utf-8");
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
