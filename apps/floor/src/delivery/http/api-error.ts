/** `apiError(status)` — the one way a Floor route refuses a request; stomps Boom's default `{statusCode, error:"Not Found", message}` payload to the `{error}` envelope every Lore client (incl. web-ui's verbatim proxy) reads. Deliberately a second copy of lore-api's `server/api-error.ts`, not shared, since `libs/shared` carries no hapi dependency on purpose (ADR-032). */

import Boom from "@hapi/boom";

export function apiError(
  statusCode: number,
  data: Record<string, unknown> = {},
): (message: string) => Boom.Boom {
  return (message) => {
    const boom = new Boom.Boom(message, { statusCode });

    // `data` merges UNDER the message so a stray `error` key can't shadow the guard's reason.
    boom.output.payload = {
      ...data,
      error: message,
    } as unknown as Boom.Payload;

    return boom;
  };
}

/** Lets a refusal out of an error-shaping `catch` untouched (it's already shaped); anything else returns and the catch shapes it as before. */
export function rethrowBoom(err: unknown): void {
  if (Boom.isBoom(err)) {
    throw err;
  }
}
