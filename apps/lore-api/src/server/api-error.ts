/** The one way a route refuses a request: shape payload to { error } envelope for client. */

import Boom from "@hapi/boom";

export function apiError(
  statusCode: number,
  details: Record<string, unknown> = {},
): (message: string) => Boom.Boom {
  return (message) => {
    const boom = new Boom.Boom(message, { statusCode });

    boom.output.payload = {
      ...details,
      error: message,
    } as unknown as Boom.Payload;

    return boom;
  };
}

/** Let a Boom error out of a catch; other errors continue to be shaped. */
export function rethrowBoom(err: unknown): void {
  if (Boom.isBoom(err)) {
    throw err;
  }
}
