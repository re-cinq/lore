/**
 * `apiError(status)` — the one way any Lore service refuses a request.
 *
 * Boom carries the status hapi renders, but its DEFAULT payload is
 * `{ statusCode, error: "Not Found", message }`, and every Lore client reads
 * `.error` as the human message (`toApiResult` in web-ui, the MCP proxy, and the
 * web UI proxying some bodies VERBATIM to the browser). So a bare
 * `Boom.notFound("assembly line not found")` reaches the user as the words "Not
 * Found" with the actual reason sitting in a `message` key nobody reads. This
 * stomps the payload to the house `{ error }` envelope.
 *
 * Built to be handed to `enforceTrue` as its ErrorType, so a refusal reads as a
 * precondition rather than an if-return:
 *
 *   enforceTrue(line !== null, apiError(404), "assembly line not found");
 *
 * SHARED as of 2026-08-24. It was deliberately duplicated while there were two
 * copies — "twenty lines in two places is the cheaper of the two prices" — and
 * that reasoning was sound for two. The event-router, stations and cluster-agent
 * made it FIVE, all byte-identical in code and differing only in comments, which
 * is where the price flips.
 *
 * `@hapi/boom` is a devDependency here, not a dependency: it is 44K and
 * independent of `@hapi/hapi`, and each server already carries it. The rule
 * `http/raw-body.ts` states — that this package must not make `@hapi/hapi`
 * resolvable-or-bust for the lean MCP adapter (ADR-032) — is about the SERVER,
 * and is unaffected.
 */

import Boom from "@hapi/boom";

export function apiError(
  statusCode: number,
  details: Record<string, unknown> = {},
): (message: string) => Boom.Boom {
  return (message) => {
    const boom = new Boom.Boom(message, { statusCode });

    // The details merge UNDER the message: a refusal often carries more than
    // prose (the run already in flight, the block that fired), and a stray
    // `error` key in them must not shadow the reason the guard fired.
    boom.output.payload = {
      ...details,
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
