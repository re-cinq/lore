/**
 * `apiError(status)` — the one way a route refuses a request.
 *
 * Boom carries the status hapi renders, but its DEFAULT payload is
 * `{ statusCode, error: "Conflict", message }`, and every Lore client reads
 * `.error` as the human message (`toApiResult` in web-ui, the MCP proxy). A bare
 * `Boom.notFound("feature not found")` therefore reaches the UI as the word
 * "Conflict" with the real reason discarded. So the payload is stomped to the
 * house `{ error }` envelope here, in ONE place — `zodFailAction` and
 * `bearer-scope` produce the same shape, and no route hand-rolls it again.
 *
 * Built to be handed to `enforceTrue` as its ErrorType, so a refusal reads as a
 * precondition rather than an if-return:
 *
 *   enforceTrue(canFinalize(status), apiError(409), `cannot finalize in '${status}'`);
 *
 * `data` merges UNDER the message: a refusal often carries more than prose (the
 * run already in flight, the block that fired), and a stray `error` key in it
 * must not shadow the reason the guard fired.
 */

import Boom from "@hapi/boom";

export function apiError(
  statusCode: number,
  data: Record<string, unknown> = {},
): (message: string) => Boom.Boom {
  return (message) => {
    const boom = new Boom.Boom(message, { statusCode });

    boom.output.payload = {
      ...data,
      error: message,
    } as unknown as Boom.Payload;

    return boom;
  };
}

/**
 * Let a refusal out of an error-shaping `catch`.
 *
 * A handler that wraps its body in `try { … } catch (err) { return
 * h.response({ error: errorMessage(err) }).code(500) }` treats every throw as an
 * unexpected failure — which is right for a dropped connection and wrong for a
 * guard that deliberately threw a 404. Call this first in such a catch: a Boom
 * arrived already shaped and carries its own status, so it goes back out
 * untouched; anything else returns and the catch shapes it as before.
 */
export function rethrowBoom(err: unknown): void {
  if (Boom.isBoom(err)) {
    throw err;
  }
}
