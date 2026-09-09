/** The one way any Lore service refuses a request; Boom with { error } envelope, enforceTrue-compatible, shared since 2026-08-24. */

import Boom from "@hapi/boom";

export function apiError(
  statusCode: number,
  details: Record<string, unknown> = {},
): (message: string) => Boom.Boom {
  return (message) => {
    const boom = new Boom.Boom(message, { statusCode });

    // Details merge UNDER message; error key must not shadow guard reason.
    boom.output.payload = {
      ...details,
      error: message,
    } as unknown as Boom.Payload;

    return boom;
  };
}

/** Let intentional Boom refusals through error-shaping catch; shaped Boom goes out untouched, anything else continues. */
export function rethrowBoom(err: unknown): void {
  if (Boom.isBoom(err)) {
    throw err;
  }
}
