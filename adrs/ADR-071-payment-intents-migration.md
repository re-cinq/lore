---
adr_number: 71
title: Migrate from Stripe Charges API to PaymentIntents API
status: accepted
date: 2025-02-14
deciders: [cto@acme.com, payments-lead@acme.com]
domains: [payments]
supersedes: null
superseded_by: null
related_prs: [PR#3401]
---

# ADR-071: Migrate from Stripe Charges API to PaymentIntents API

## Context

Stripe deprecated the Charges API. The PaymentIntents API is the replacement, and it supports SCA (Strong Customer Authentication) as required by PSD2 in the European Union. Our current Charges-based integration will stop working for EU customers when Stripe enforces the deprecation deadline.

Beyond regulatory compliance, PaymentIntents gives us better handling of asynchronous payment flows — 3D Secure challenges, bank redirects, and delayed confirmation. The Charges API was never designed for these, and our workarounds for 3DS were brittle.

We have roughly 80% of our paying customers in the EU. This is not optional.

## Decision

Migrate all charge creation from the Charges API to the PaymentIntents API. The internal `ChargeBuilder` interface stays stable — callers in the billing service, subscription manager, and invoice processor don't need to change their code. Internally, `ChargeBuilder.build()` now creates a PaymentIntent instead of a Charge object.

The migration is behind a feature flag (`use_payment_intents`) during rollout. Both code paths exist temporarily so we can switch back if we hit issues. Once we've confirmed stability in production for two weeks, the Charges code path gets deleted.

Webhook handlers are updated to listen for `payment_intent.succeeded` and `payment_intent.payment_failed` instead of `charge.succeeded` and `charge.failed`. During the migration window, both event types are handled.

Idempotency keys use the same generation scheme as before, so retries remain safe across the transition.

## Consequences

- **Webhook updates**: Every webhook handler that references Charge events needs updating. There are 6 handlers across 2 services. PR#3401 covers all of them.
- **Testing**: Stripe's test mode PaymentIntents behave differently from test Charges in some edge cases (e.g., `requires_action` states). Test fixtures needed updating.
- **Monitoring**: Dashboards and alerts that key on `charge.succeeded` events need to be duplicated for `payment_intent.succeeded` during the migration window, then switched over.
- **Refund flow**: Refunds still use the Refunds API, which works with both Charges and PaymentIntents. No change needed there.
- **Timeline**: The feature flag was enabled for 5% of traffic on 2025-02-20, ramped to 100% by 2025-03-01. Charges code path removed in PR#3450.

## Alternatives Rejected

### Stripe Checkout Sessions

Checkout Sessions handle SCA automatically but are too opinionated about the UI flow. They redirect customers to a Stripe-hosted page or require embedding Stripe's prebuilt UI components. We need server-side control over the payment flow because our checkout process includes custom fraud checks, loyalty point redemption, and split payments — none of which fit into Checkout Sessions without ugly hacks.

### Building an abstraction layer over multiple payment providers

We considered wrapping Stripe behind a generic payment provider interface so we could swap in Adyen or Braintree later. This is a textbook YAGNI violation. We're Stripe-only, we have no plans to add another provider, and the abstraction would add complexity to every payment change for a benefit we may never need. If we ever do need multi-provider support, we can build the abstraction then with actual requirements instead of guessing.
