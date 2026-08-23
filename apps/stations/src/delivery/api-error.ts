/**
 * `apiError(status)` — the one way a stations route refuses a request.
 *
 * Boom carries the status hapi renders, but its DEFAULT payload is
 * `{ statusCode, error: "Not Found", message }`, and every Lore client reads
 * `.error` as the human message. The web UI proxies these bodies VERBATIM to the
 * browser (`app/api/assembly-runs/**`, `app/api/tasks/[id]/logs`), so a bare
 * `Boom.notFound("assembly line not found")` reached the user as the words "Not
 * Found" with the actual reason sitting in a `message` key nobody reads. This
 * stomps the payload to the `{ error }` envelope lore-api already speaks.
 *
 * Built to be handed to `enforceTrue` as its ErrorType, so a refusal reads as a
 * precondition:
 *
 *   enforceTrue(line !== null, apiError(404), "assembly line not found");
 *
 * DELIBERATELY a third copy (lore-api's `server/api-error.ts`, the Floor's) rather than a
 * shared module. The helper constructs a Boom, and `libs/shared` carries no hapi
 * dependency on purpose: it is installed in the MCP adapter, whose whole point is
 * not to haul the servers' dependencies along (ADR-032 — `http/raw-body.ts`
 * refuses even a type-only hapi import for the same reason). Twenty lines in two
 * places is the cheaper of the two prices.
 */

import Boom from "@hapi/boom";

export function apiError(
  statusCode: number,
  data: Record<string, unknown> = {},
): (message: string) => Boom.Boom {
  return (message) => {
    const boom = new Boom.Boom(message, { statusCode });

    // `data` merges UNDER the message: a stray `error` key must not shadow the
    // reason the guard fired.
    boom.output.payload = {
      ...data,
      error: message,
    } as unknown as Boom.Payload;

    return boom;
  };
}

/**
 * Let a refusal out of an error-shaping `catch`. A Boom arrived already shaped
 * and carries its own status, so it goes back out untouched; anything else
 * returns and the catch shapes it as before.
 */
export function rethrowBoom(err: unknown): void {
  if (Boom.isBoom(err)) {
    throw err;
  }
}
