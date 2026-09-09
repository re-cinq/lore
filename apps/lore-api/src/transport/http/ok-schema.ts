// The `ok` discriminator every write route's response envelope carries, declared once so a route names the shape instead of re-spelling the literal.

import { z } from "zod";

export const OkTrue = z.literal(true); // eslint-disable-line re-lint/no-flag-params -- the literal VALUE the envelope carries, not a flag argument

export const OkFalse = z.literal(false); // eslint-disable-line re-lint/no-flag-params -- the literal VALUE the envelope carries, not a flag argument

export const OkSchema = z.object({ ok: OkTrue });
