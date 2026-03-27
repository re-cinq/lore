---
adr_number: 89
title: Adopt structured JSON logging across all services
status: accepted
date: 2025-06-20
deciders: [platform-lead@acme.com, sre-lead@acme.com]
domains: [platform, payments, identity, data]
supersedes: null
superseded_by: null
related_prs: [PR#4102, PR#4115, PR#4118]
---

# ADR-089: Adopt Structured JSON Logging Across All Services

## Context

During the March 2025 payments outage, debugging took 4 hours because we couldn't correlate requests across services. Logs were unstructured text — each service used a different format, some included timestamps and some didn't, and none carried a correlation ID that could link a single user request across the payment service, identity service, and billing service.

The on-call engineer resorted to grep and eyeball-matching timestamps across three different log streams. This is not a repeatable process, and it won't scale as we add more services.

With structured logs and a correlation ID propagated through the call chain, the same debugging session would have taken minutes: query Datadog for the correlation ID, see every log line from every service for that request, done.

The outage cost us approximately 45 minutes of downtime and a measurable dip in customer trust. The migration effort to structured logging is estimated at 2-3 days per service. We have 7 services. The math is straightforward.

## Decision

All services emit structured JSON logs. Every log line is a single JSON object with these mandatory fields:

| Field | Type | Description |
|---|---|---|
| `correlation_id` | string (UUID) | Propagated via `X-Correlation-ID` header. Generated at the edge if not present. |
| `service` | string | Service name, e.g., `payments-api`, `identity-svc`. |
| `level` | string | One of: `debug`, `info`, `warn`, `error`. |
| `timestamp` | string (ISO 8601) | UTC, with millisecond precision. |
| `message` | string | Human-readable log message. |

Additional fields are allowed and encouraged (e.g., `user_id`, `payment_id`, `duration_ms`), but the five above are required.

Logging libraries per language:

- **Node.js**: pino
- **Python**: structlog
- **Go**: zap

No `println`, `console.log`, `fmt.Println`, or `print()` in production code. Linter rules enforce this. Debug-level logs are acceptable for local development but must use the structured logger.

Log levels follow standard semantics:

- **debug**: Development-time detail. Not shipped to Datadog in production.
- **info**: Normal operations — request handled, job completed, connection established.
- **warn**: Something unexpected that the system handled — retries, fallbacks, slow queries.
- **error**: Something failed and needs attention — unhandled exceptions, external service failures, data inconsistencies.

## Consequences

- **Migration effort**: Each service needs 2-3 days of work to replace existing log calls with the structured logger. PR#4102 (payments), PR#4115 (identity), and PR#4118 (data pipeline) are the first three. Remaining services are tracked in the Q3 roadmap.
- **Datadog pipeline**: The log ingestion pipeline in Datadog needs reconfiguring to parse JSON instead of applying grok patterns to text lines. This actually simplifies the pipeline — JSON parsing is built-in, grok patterns were fragile and broke whenever someone changed a log format.
- **Log volume**: Structured logs are slightly larger per line due to JSON overhead. We measured roughly 15% increase in log bytes. At our current volume this adds about $30/month to Datadog costs. Acceptable.
- **Local development**: Developers can pipe logs through `pino-pretty` (Node.js) or equivalent formatters so they're not reading raw JSON in their terminals.
- **Correlation ID propagation**: Every HTTP client and message queue consumer must forward the `X-Correlation-ID` header. Middleware handles this for inbound requests; outbound HTTP clients and queue publishers need explicit plumbing.

## Alternatives Rejected

### Standardized prefix format for text logs

We considered keeping text logs but enforcing a prefix format like `[timestamp] [service] [level] [correlation_id] message`. This is better than nothing, but text log parsing is inherently brittle. A message containing a bracket breaks your regex. A field added to the prefix breaks every existing parser. JSON is self-describing and every log aggregator knows how to handle it natively.

### OpenTelemetry logs only

OTel is our eventual direction for observability, and its logging bridge API would unify logs, traces, and metrics under one framework. However, at the time of this decision (June 2025), OTel log support in our target languages was still marked as experimental or had significant gaps (Python's OTel log handler lacked structured context propagation). We needed a fix before Q3, not a bet on a spec reaching stability. When OTel logs graduate to stable, we can adopt them — the structured JSON format we're using now is compatible with OTel's log data model, so migration will be mechanical.
