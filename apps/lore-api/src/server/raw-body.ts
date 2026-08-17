/**
 * The unparsed request body. The webhook ingress routes (`/api/webhook/slack`,
 * `/api/webhook/incident`) set `payload: { parse: false }` so they can verify
 * their own HMAC / handle URL-encoded bodies (ADR-034 FR7); every JSON API route
 * lets hapi parse the payload and reads `request.payload`.
 *
 * The implementation is shared with the Floor server, where it was byte-identical
 * (#1051). That re-export also brings `rawBytes` into this app's surface, which it
 * did not have before: no lore-api route needs the bytes today, but a binary body
 * read through `rawBody` is silently corrupted by its utf-8 decode, so the correct
 * function should be reachable rather than re-invented when one does.
 */

export { rawBody, rawBytes } from "@re-cinq/lore-shared/http/raw-body.js";
