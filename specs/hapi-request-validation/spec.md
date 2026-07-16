# Feature Specification: Move lore-api request validation into hapi's `options.validate` (zod)

| Field    | Value                                                              |
|----------|-------------------------------------------------------------------|
| Feature  | Replace hand-rolled body parsing + imperative field checks with declarative zod schemas wired into hapi's `options.validate` |
| Status   | In Progress                                                       |
| Created  | 2026-07-03                                                        |
| Owner    | Platform Engineering                                             |
| ADR      | [ADR-034](../../adrs/ADR-034-lore-api-request-validation.md) (to be written) — amends [ADR-033](../../adrs/ADR-033-lore-api-hapi.md) |

This spec moves lore-api's per-route request validation into hapi's `options.validate` using declarative zod schemas, retiring the hand-rolled body parsing and scattered imperative field checks that each write route currently repeats inside its handler.

## Problem Statement

The hapi migration (ADR-033) made lore-api's routing declarative, but stopped
short of the validation lifecycle. Every write route still parses and validates
its request body **by hand, inside the handler**:

- Routes set [`payload: { parse: false }`](../../apps/lore-api/src/api/routes/memory/memory.ts#L14)
  so hapi delivers the body as a raw Buffer, then call
  [`rawBody`](../../apps/lore-api/src/server/raw-body.ts#L10) + `JSON.parse`
  (or [`parseJsonBodyCapped`](../../apps/lore-api/src/server/raw-body.ts#L24))
  themselves. This exists **only** to reproduce the legacy dispatcher's quirk of
  returning `500` on malformed JSON (hapi's own parser returns `400`). It was a
  migration-compatibility artifact, never a desired contract.
- Field validation is imperative and scattered: `if (!key || !value) return 400`
  in [`memory.ts`](../../apps/lore-api/src/api/routes/memory/memory.ts#L23),
  `if (!description?.trim())` in
  [`task-post.ts`](../../apps/lore-api/src/api/routes/tasks/task-post.ts#L59),
  `enforceFeatureInput(...)` in
  [`features.ts`](../../apps/lore-api/src/api/routes/features/features.ts#L76).
  There is no single declaration of "what a valid request to this route looks
  like."
- The domain logic is buried under `try { JSON.parse ... } catch { 500 }`
  boilerplate repeated across ~15 write routes.
- **hapi gives per-route validation for free** — `options.validate.{payload,query,params}`
  runs in the request lifecycle, before the handler, with typed results — and we
  use none of it.

This is the "we have a framework now, stop doing this by hand" cleanup the
migration explicitly deferred. It also unblocks OpenAPI generation (a separate
feature): declarative schemas are the thing an API document is generated from.

## Solution

Adopt hapi's request-validation lifecycle, keeping **zod** as the schema language
(already a dependency, already used across the codebase; ADR-033 chose zod over
joi — that holds).

### The zod-to-hapi validator

hapi's `options.validate.{payload,query,params}` accepts a **validation function**
`(value, options) => Promise<value>`: it receives the parsed value, returns the
(optionally coerced) validated value, and throws to fail validation. A single
shared adapter bridges zod to that contract:

```ts
// server/plugins/zod-validate.ts
export const zodValidate = (schema: ZodType) => async (value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(formatZodError(result.error));
  return result.data;               // typed, coerced payload reaches the handler
};
```

Failures are shaped to the **existing `{ error: <message> }` 400 body** — matching
what every handler returns today and what `bearer-scope.ts` already does by
overriding `boom.output.payload`. A route-level `failAction` (or a Boom whose
payload is pre-shaped) guarantees the envelope, so no route emits hapi's default
`{ statusCode, error, message }` shape.

### Routes declare schemas, hapi parses

Write routes drop `parse: false` and let hapi parse the JSON payload natively.
Each declares its schema:

```ts
options: {
  ...bearerScope("write"),
  validate: { payload: zodValidate(WriteMemoryBody) },
}
handler: (request, h) => {
  const body = request.payload as WriteMemoryBody;   // already validated + typed
  ...
}
```

`rawBody` / `parseJsonBodyCapped` / in-handler `JSON.parse` are deleted once no
route depends on them. The 1 MB `payload.maxBytes` body cap (server default) and
its native `413` are unchanged.

### Deliberate, documented behavior change

Letting hapi parse the payload means **malformed JSON now returns `400`, not the
migration-preserved `500`.** `400` is the correct code for malformed client
input; `500` was pure legacy mimicry. This is the one intentional contract change
and is recorded in ADR-034. All other outcomes (status codes, success bodies,
auth, rate limit) are unchanged.

### Polymorphic bodies

Two routes dispatch on a body field rather than taking one fixed shape:

- [`/api/memory`](../../apps/lore-api/src/api/routes/memory/memory.ts) — `action`
  ∈ {write, read, search, delete, list}, each requiring different fields.
- [`POST /api/task`](../../apps/lore-api/src/api/routes/tasks/task-post.ts) —
  create / retry / cancel / set-priority / status-update.

These are modelled with a **zod discriminated union** on the `action` field where
it maps cleanly, so per-action required fields (`write` needs `key` + `value`)
become schema constraints instead of nested `if` checks. Where a route's variants
are too irregular for one union without contorting the schema, it keeps a
permissive top-level schema (well-formed object) and documents the residual
in-handler branching — validation still moves to `options.validate`; the handler
stops re-deriving field presence it can now trust.

### Ordering

hapi runs auth → payload parse → validation → handler. An under-scoped or missing
token therefore still fails (`403` / `401`) **before** validation, exactly as
today. Validation errors surface only for authenticated requests.

## Functional Requirements

- **FR1** A single shared adapter (`server/plugins/zod-validate.ts`) converts a
  zod schema into a hapi `options.validate` function for `payload`, `query`, and
  `params`; `getZodSchema` returns `undefined` for a validator it did not build. ([validated by `zod-validate.test.ts:17`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L17), [validated by `zod-validate.test.ts:35`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L35))
- **FR2** Every native **write** route (`POST`/`PUT`/`DELETE` with a body)
  declares a zod `payload` schema via the adapter; routes with constrained query
  or path params declare `query`/`params` schemas where it removes an in-handler
  check.
- **FR3** Validation failures return HTTP `400` with body `{ error: <message> }`
  (the existing convention), never hapi's default `{ statusCode, error, message }`
  envelope. The message names the offending field (dotted path) where zod provides
  it, falling back to `invalid request` when there are no issues. ([validated by `zod-validate.test.ts:63`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L63), [validated by `zod-validate.test.ts:23`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L23), [validated by `zod-validate.test.ts:43`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L43), [validated by `zod-validate.test.ts:55`](apps/lore-api/src/server/plugins/zod-validate.test.ts#L55))
- **FR4** hapi parses request payloads natively (`parse: true`); handlers receive
  a typed, validated `request.payload`. No native-route handler calls `JSON.parse`,
  `rawBody`, or `parseJsonBodyCapped`. Those helpers are deleted when unused. A
  route whose payload override forces JSON parsing parses a JSON body even when the
  client sends a non-JSON `Content-Type`. ([validated by `ingest-graph.test.ts:57`](apps/lore-api/src/api/routes/ingest/ingest-graph.test.ts#L57))
- **FR5** Auth, rate-limit, and body-cap behavior are unchanged: `401` (missing
  token) and `403` (under-scoped) still precede validation; `413` still fires at
  1 MB; the per-bucket `429` thresholds are untouched.
- **FR6** Polymorphic routes (`/api/memory`, `POST /api/task`) validate via a zod
  discriminated union on their dispatch field, or — where a union would contort —
  a documented permissive schema plus residual handler branching. ([validated by `memory.test.ts:110`](apps/lore-api/src/api/routes/memory/memory.test.ts#L110))
- **FR7** Webhook ingress routes (`/api/webhook/slack`, `/api/webhook/incident`)
  are **out of scope**: they keep `parse: false` and their own HMAC / URL-encoded
  body handling. This feature touches JSON API routes only.

## Success Criteria

- **SC-1** `grep -rE "rawBody|parseJsonBodyCapped|JSON.parse" apps/lore-api/src/api/routes`
  returns nothing outside the webhook routes (FR7) and tests.
- **SC-2** Malformed JSON to a native route returns `400` (documented change from
  `500`); the affected tests (`memory.test.ts`, `task-post.test.ts`) assert `400`
  and reference ADR-034. ([validated by `memory.test.ts:277`](apps/lore-api/src/api/routes/memory/memory.test.ts#L277), [validated by `ingest-graph.test.ts:74`](apps/lore-api/src/api/routes/ingest/ingest-graph.test.ts#L74))
- **SC-3** For each converted route, a request missing or mis-typing a required
  field returns `400` `{ error: <message> }` with the field named — proven by a
  test migrated alongside the route.
- **SC-4** Auth + rate-limit outcomes unchanged: under-scoped → `403`, missing →
  `401`, both before validation; `rate-limit.test.ts` still green. ([validated by `memory.test.ts:292`](apps/lore-api/src/api/routes/memory/memory.test.ts#L292))
- **SC-5** `apps/lore-api` typechecks (`tsc --noEmit`) and the full vitest suite
  is green. Each route group is an independently-revertable commit.

## Out of Scope

- **OpenAPI / Swagger generation** — enabled by this feature (declarative
  schemas), but its own follow-on. Not built here.
- **Webhook body handling** (slack URL-encoded + HMAC, incident) — keeps its
  current `parse: false` path (FR7).
- **Changing any route's path, success contract, auth scope, or rate-limit
  budget.** The only intentional contract change is malformed-JSON `500 → 400`
  (ADR-034). Everything else is preserved.
- **Swapping zod for joi** — ADR-033's choice stands.
