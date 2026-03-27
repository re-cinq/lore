# Payments Team

## Monetary Amounts (ADR-042)

All monetary amounts are stored and transmitted in **minor units** (cents for USD, pence for GBP, etc.). Never use floating-point types for money. The `MonetaryAmount` value object in `pkg/money` enforces this — it holds an `int64` amount and a currency code. Use it everywhere: API requests, database columns, event payloads, internal calculations.

If you see a float used for money anywhere, that's a bug. Fix it.

```go
// Correct
charge := money.NewAmount(1499, money.USD) // $14.99

// Wrong — do not do this
price := 14.99
```

## PCI Scope

`payments-service` is the only service in PCI scope. Card data never touches our servers — customers enter card details in Stripe Elements on the client side, and we receive a Stripe token. We store Stripe token references (`pm_*`, `pi_*`) and customer IDs (`cus_*`), never raw card numbers or CVVs.

If you're adding a feature that touches card data or payment method details, talk to @payments-lead before writing any code. Changes to PCI-scoped code require a security review.

## Idempotency

All charge operations require an `IdempotencyKey`. The client generates the key (UUID v4) and sends it with the request. We store the key in Redis with a 24-hour TTL. If a duplicate request arrives within 24 hours, we return the original response without re-processing.

The `IdempotencyKey` is also passed to Stripe's API via their `Idempotency-Key` header, so we get end-to-end idempotency.

Implementation: see `internal/idempotency/store.go`. The middleware in `internal/middleware/idempotency.go` handles the check-before-execute flow.

## Stripe Webhooks

Webhooks are received at `/webhooks/stripe`. Every incoming webhook must pass Stripe signature validation (`stripe.ConstructEvent` with our webhook signing secret). Reject anything that fails.

Webhook handlers are idempotent — processing the same event twice produces the same result. We track processed event IDs in the `stripe_events` table to detect duplicates.

Process events in the order Stripe sends them. For a given payment, events follow a defined lifecycle: `payment_intent.created` -> `payment_intent.succeeded` / `payment_intent.payment_failed`. If we receive an event out of order (e.g., `succeeded` before `created`), log a warning and retry with backoff.

## Current Work

**Migration to PaymentIntents API (ADR-071).** We're migrating from Stripe's legacy Charges API to the PaymentIntents API. This is required for SCA compliance in EU markets and gives us better support for async payment methods.

Status: charges endpoint still active, new PaymentIntents endpoint in staging. Target is to have all new charges going through PaymentIntents by end of Q2. The legacy Charges path will stay around for 90 days after that to handle in-flight transactions, then we remove it.

Tracking: see the `payment-intents-migration` label in Linear.
