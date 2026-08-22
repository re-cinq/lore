---
adr_number: 34
title: "Move lore-api request validation into hapi's options.validate (zod)"
status: in progress
date: 2026-07-03
domains: [lore-api, http, validation, dx]
relates: "specs/hapi-request-validation/spec.md"
amends: "adrs/ADR-033-lore-api-hapi.md"
---

# ADR-034: lore-api request validation via hapi `options.validate` (zod)

This ADR wires zod schemas into hapi's options.validate through a shared adapter so each write route declares its request contract in one place instead of hand-parsing bodies in the handler, and corrects malformed-JSON responses from a legacy 500 to a proper 400.

## Context

ADR-033 migrated lore-api to hapi and made routing declarative, but deliberately
left validation for a follow-up ("Route validation, where added, calls the
existing zod schemas" — ADR-033 §5). As a result every write route still parses
and validates its body **by hand, inside the handler**:

- Routes set `payload: { parse: false }` so hapi delivers the body as a raw
  Buffer, then call `rawBody` + `JSON.parse` (or `parseJsonBodyCapped`)
  themselves. This exists **only** to reproduce the legacy `node:http`
  dispatcher's quirk of returning `500` on malformed JSON — hapi's own parser
  returns `400`. It was migration-compatibility mimicry, never an intended
  contract.
- Field validation is imperative and scattered: `if (!key || !value) return 400`
  (`memory.ts`), `if (!description?.trim())` (`task-post.ts`), and similar across
  ~15 write routes. No single declaration states what a valid request looks like.
- hapi's request-validation lifecycle (`options.validate.{payload,query,params}`,
  which runs before the handler with typed results) is unused.

The migration is complete and green, so the compatibility constraint that forced
the `500`-on-bad-JSON mimicry no longer applies. This ADR records the decision to
finish the job ADR-033 deferred.

## Decision

**Wire zod schemas into hapi's `options.validate` via a shared adapter.**

1. **A single adapter** — `server/plugins/zod-validate.ts` — converts a zod
   schema into a hapi validation function `(value) => data`: it `safeParse`s the
   value, returns the typed/coerced data on success, and throws on failure. Used
   for `payload`, `query`, and `params`.

2. **Failures return the existing `{ error: <message> }` 400 body.** The adapter
   throws a Boom whose `output.payload` is pre-shaped to `{ error }` — the exact
   pattern `bearer-scope.ts` already uses — so no route emits hapi's default
   `{ statusCode, error, message }` envelope. The message names the first
   offending field where zod provides it.

2a. **`apiError(status, data?)` is the single owner of that stomp** (amendment,
   2026-08-22). The shaping above had been copied into `zod-validate.ts` and
   `bearer-scope.ts` independently, and two routes threw bare Boom and shipped
   the default envelope regardless. `server/api-error.ts` now builds every
   refusal, and every route hands it to `enforceTrue` so an HTTP refusal reads as
   a precondition rather than an if-return (`lore/prefer-api-error` enforces it).

- A refusal carries the status hapi renders ([validated by carries the status on a boom hapi renders](apps/lore-api/src/server/api-error.test.ts#L6)).
- Its payload is the house `{ error }` envelope, not Boom's default ([validated by payload is the house error envelope, not boom's default](apps/lore-api/src/server/api-error.test.ts#L13)).
- A refusal that carries more than prose merges that data alongside the message ([validated by extra data rides alongside the message](apps/lore-api/src/server/api-error.test.ts#L19)).
- A stray `error` key in that data never shadows why the guard fired ([validated by a data key named error does not override the message](apps/lore-api/src/server/api-error.test.ts#L31)).

2c. **The Floor speaks the same envelope** (amendment, 2026-08-22). The Floor's
   hapi server threw bare Boom almost everywhere, so it shipped
   `{ statusCode, error: "Not Found", message }` while a handful of its own
   routes returned `{ error }` — two envelopes from one server. The web UI
   proxies those bodies verbatim to the browser
   (`app/api/assembly-runs/**`, `app/api/tasks/[id]/logs`), which reads `.error`
   as the message, so a 404 reached the user as the words "Not Found". The Floor
   now has its own `delivery/http/api-error.ts` — a deliberate second copy,
   because `libs/shared` carries no hapi dependency by design (ADR-032).

- A Floor refusal carries the status hapi renders ([validated by carries the status hapi renders](apps/floor/src/delivery/http/api-error.test.ts#L6)).
- Its payload is the `{ error }` envelope the web UI proxies ([validated by payload is the error envelope the web UI proxies, not boom's default](apps/floor/src/delivery/http/api-error.test.ts#L13)).
- Data rides alongside the message there too ([validated by extra data rides alongside the message](apps/floor/src/delivery/http/api-error.test.ts#L19)).
- A shaped refusal passes back out of a Floor catch ([validated by a refusal a guard already shaped passes straight back out](apps/floor/src/delivery/http/api-error.test.ts#L28)).
- An ordinary Floor failure stays the catch block's to shape ([validated by an ordinary failure is the catch block's to shape](apps/floor/src/delivery/http/api-error.test.ts#L34)).

2b. **A refusal survives an error-shaping `catch`.** A handler that wraps its
   body in `try { … } catch { return … .code(500) }` would otherwise reshape a
   guard's deliberate 404 into a server fault.

- An already-shaped Boom passes straight back out of such a catch ([validated by a refusal a guard already shaped passes straight back out](apps/lore-api/src/server/api-error.test.ts#L41)).
- An ordinary failure stays the catch block's to shape ([validated by an ordinary failure is the catch block's to shape](apps/lore-api/src/server/api-error.test.ts#L47)).

3. **hapi parses payloads natively** (`parse: true`, the default). Write routes
   drop `parse: false`; handlers read a typed, validated `request.payload`
   instead of calling `JSON.parse` / `rawBody` / `parseJsonBodyCapped`. Those
   helpers are deleted when unused — except `rawBody`, which the webhook routes
   still need. The server sets `routes.payload.override = "application/json"` so
   the body is parsed as JSON **regardless of the client's `Content-Type`** —
   the pre-hapi handlers `JSON.parse`d the raw buffer content-type-agnostically,
   and this preserves that (a JSON body with a missing or wrong `Content-Type`
   still parses). Webhook routes set `parse: false` and own their raw body, so
   the override does not touch them.

4. **Malformed JSON now returns `400`, not `500`.** This is the one intentional
   contract change. `400` is the correct code for malformed client input; the
   `500` was pure legacy mimicry. Two tests (`memory.test.ts`, `task-post.test.ts`)
   flip their invalid-JSON assertion from `500` to `400` and cite this ADR.

5. **zod stays; joi is not introduced** — ADR-033's choice holds (fewest
   elements). Domain validators that also transform (`enforceFeatureInput`,
   `parseGapResult`/`sanitizeGapResult`) remain in their handlers, fed the parsed
   `request.payload`; a thin schema guards shape. Only field-presence checks move
   into the schema.

6. **Polymorphic routes** (`/api/memory`, `POST /api/task`) validate via a zod
   **discriminated union** on their dispatch field, or — where a union would
   contort — a permissive schema plus documented residual branching.

7. **Webhook ingress is out of scope.** `/api/webhook/slack` (URL-encoded body +
   HMAC) and `/api/webhook/incident` keep `parse: false` and their own body
   handling.

Auth, rate-limit, and the 1 MB body cap are unchanged. hapi runs auth → payload
parse → validation → handler, so a missing/under-scoped token still fails
(`401`/`403`) **before** validation, exactly as today.

## Consequences

**Positive**

- Each route's request contract is declared in one place (its schema), not
  re-derived by imperative checks inside the handler.
- Malformed input is rejected before the handler runs, with the correct `400`.
- Handlers stop carrying `try { JSON.parse } catch { 500 }` boilerplate; they
  receive typed payloads.
- Declarative schemas are the substrate an OpenAPI document is generated from —
  this unblocks that follow-on feature.

**Negative / costs**

- One visible contract change: malformed JSON `500 → 400` on write routes.
  Documented here; the two affected tests are updated to match. No success body,
  path, scope, or rate-limit budget changes.
- Polymorphic routes need discriminated-union schemas, which are more schema
  code than a flat object; a couple of irregular routes keep residual in-handler
  branching rather than forcing an awkward union.

**Neutral**

- Structural, contract-preserving except for the documented `500 → 400`. Mirrors
  ADR-033's per-group, independently-revertable rollout.

## Alternatives considered

1. **Keep the `500`-on-bad-JSON behavior (half-refactor).** Move field checks to
   zod but keep `parse: false` + a `JSON.parse` wrapper so malformed JSON still
   `500`s. Rejected: it preserves an accidental contract at the cost of never
   using hapi's payload parser, leaving the handler still hand-parsing. The value
   of this change is precisely to stop that.

2. **Adopt joi (hapi's native validator).** Rejected: zod is already the repo's
   schema language and a dependency; introducing joi duplicates that surface for
   no gain (ADR-033 already rejected joi on the same axis).

3. **Status quo — leave validation hand-rolled.** Rejected: it is the debt
   ADR-033 explicitly deferred, it blocks OpenAPI generation, and it keeps an
   unintended `500` contract on malformed input.
