# Lore Platform — Engineering Guide

## Architecture

**Service communication.** All external traffic enters through `platform-api` (the API gateway). Clients never call backend services directly. Between backend services, communication is gRPC with Protobuf. External-facing APIs (mobile, third-party integrations) are REST over HTTPS.

**Database ownership.** Each service owns its database schema exclusively. No cross-service joins. If service A needs data from service B, it calls service B's API or consumes events. Payments uses PostgreSQL, identity uses PostgreSQL, data-pipeline reads/writes BigQuery. No shared database instances in production.

**Event patterns.** Cross-service events are async via Google Cloud Pub/Sub. Events are Protobuf-encoded. Every event includes a `correlation_id`, `event_type`, `timestamp`, and `source_service`. Services publish domain events (e.g., `payment.completed`, `user.created`) and other services subscribe as needed. Events are not a substitute for API calls when you need a synchronous response.

## Code Conventions

**Error handling.** Use typed errors with numeric error codes (see `pkg/errors/codes.go`). Never swallow errors — if you catch one, either handle it meaningfully or propagate it. All error logs must include the `correlation_id` from the request context. Prefer wrapping errors with `fmt.Errorf("operation failed: %w", err)` to preserve the chain.

**Logging.** Structured JSON logging via `pkg/log`. Every log line must include these fields:
- `correlation_id` — from the incoming request, propagated through all downstream calls
- `service` — the emitting service name
- `level` — one of `debug`, `info`, `warn`, `error`
- `timestamp` — RFC 3339, UTC

Do not log PII. Do not log raw request bodies in production.

**Auth patterns.** Authentication uses JWT issued by Auth0. The API gateway (`platform-api`) validates tokens and rejects invalid/expired ones before they hit backend services. Authenticated user context (user ID, roles, org ID) is passed to backend services via gRPC metadata headers (`x-user-id`, `x-user-roles`, `x-org-id`). Backend services trust these headers because all traffic flows through the mesh (mTLS enforced by Istio).

## Key Services

**payments-service** — Handles all payment processing via Stripe. Manages the charge lifecycle: create, capture, refund. Owns the `payments` schema in PostgreSQL. Publishes events on `payment.created`, `payment.captured`, `payment.refunded`, `payment.failed`. See `teams/payments/CLAUDE.md` for PCI scope and idempotency rules.

**identity-service** — User management and access control. Integrates with Auth0 for authentication. Manages RBAC: roles are `owner`, `admin`, `member`, `viewer`. Owns the `identity` schema. Publishes `user.created`, `user.updated`, `user.role_changed` events.

**platform-api** — API gateway built on Kong, running on GKE. Handles rate limiting (per API key), JWT validation, request routing, and CORS. All external traffic enters here. See `teams/platform/CLAUDE.md` for rate limit configuration.

**data-pipeline** — ETL and event processing. Apache Beam pipelines running on Google Cloud Dataflow. Reads events from Pub/Sub, transforms and loads into BigQuery. Also runs scheduled batch jobs for reporting aggregations. See `teams/data/CLAUDE.md` for pipeline details.
