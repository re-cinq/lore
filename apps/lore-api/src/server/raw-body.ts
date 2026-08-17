/**
 * The unparsed request body. The webhook ingress routes (`/api/webhook/slack`,
 * `/api/webhook/incident`) set `payload: { parse: false }` so they can verify
 * their own HMAC / handle URL-encoded bodies (ADR-034 FR7); every JSON API route
 * lets hapi parse the payload and reads `request.payload`.
 *
 * The implementation is shared with the Floor server, where it was byte-identical
 * (#1051).
 */

export { rawBody, rawBytes } from "@re-cinq/lore-shared/http/raw-body.js";
