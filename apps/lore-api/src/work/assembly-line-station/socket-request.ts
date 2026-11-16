// A `request` on the live socket: any lore-api route, run in-process as the person the socket's cookie names, so the route's own bearer check, scope, validation, rate limit and repo checks apply unchanged.

import type { RequestMessage, ResponseMessage } from "./protocol.js";

export interface InjectOptions {
  method: RequestMessage["method"];
  url: string;
  headers: { authorization: string };
  payload?: string | object;
}

export type SocketInject = (
  options: InjectOptions,
) => Promise<{ statusCode: number; payload: string }>;

const API_PREFIX = "/api/";
const UNREACHABLE_PREFIXES = ["/api/auth/", "/api/webhook", "/api/ws"];

const reply = (id: string, status: number, body: unknown): ResponseMessage => ({
  type: "response",
  id,
  status,
  body,
});

export async function answerRequest(
  message: RequestMessage,
  sessionToken: string | undefined,
  inject: SocketInject,
): Promise<ResponseMessage> {
  if (!sessionToken) {
    return reply(message.id, 401, { error: "no session" });
  }
  const url = reachableUrl(message.path);

  if (url === null) {
    return reply(message.id, 404, { error: "not found" });
  }
  const answer = await inject({
    method: message.method,
    url,
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: payloadOf(message.body),
  });

  return reply(message.id, answer.statusCode, bodyOf(answer.payload));
}

/** The path as the router will see it, or null for one a socket may not reach; matched after decoding, so an escaped letter cannot slip past. */
function reachableUrl(path: string): string | null {
  const url = new URL(path, "http://lore");
  const target = decodedLowerCase(url.pathname);

  return target !== null && reachable(target)
    ? `${url.pathname}${url.search}`
    : null;
}

/** Inside the api once its dots are resolved, and none of the doors a socket has no business at. */
function reachable(target: string): boolean {
  return (
    target.startsWith(API_PREFIX) &&
    !UNREACHABLE_PREFIXES.some((prefix) => target.startsWith(prefix))
  );
}

function decodedLowerCase(pathname: string): string | null {
  try {
    return decodeURI(pathname).toLowerCase();
  } catch {
    return null;
  }
}

function payloadOf(body: unknown): string | object | undefined {
  return typeof body === "object" || body === undefined
    ? (body ?? undefined)
    : JSON.stringify(body);
}

function bodyOf(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
