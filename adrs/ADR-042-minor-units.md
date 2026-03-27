---
adr_number: 42
title: Store all monetary amounts in minor units
status: accepted
date: 2023-08-03
deciders: [cto@acme.com, dana@acme.com]
domains: [payments, billing, subscriptions]
supersedes: null
superseded_by: null
related_prs: [PR#1201, PR#1847]
---

# ADR-042: Store All Monetary Amounts in Minor Units

## Context

The billing service originally stored monetary amounts as floating-point numbers (e.g., `9.99`). This worked fine in isolation, but rounding errors accumulated during batched payouts. A 0.01 EUR discrepancy per transaction is invisible on a single charge. At 50,000 transactions per batch, it becomes a real accounting problem.

We discovered this when reconciliation reports started showing mismatches against Stripe's ledger. The root cause was IEEE 754 floating-point arithmetic — `0.1 + 0.2 != 0.3` in every language we use. The billing team spent two days tracking down a discrepancy that turned out to be death by a thousand rounding errors.

## Decision

All monetary values are stored and transmitted as integers representing the smallest currency unit. For EUR and USD, that means cents: `999` instead of `9.99`.

Conversion to a human-readable display format (e.g., "9.99 EUR") happens exclusively at the presentation layer — API responses, invoices, emails, admin dashboards. No business logic, database column, message payload, or internal API should ever use a float for money.

A `MonetaryAmount` value object enforces this at the type level. It holds an integer `amount` and a `currency` code. Arithmetic operations are defined on this type, and it refuses construction from a float.

## Consequences

- **Onboarding**: New engineers need to learn this convention early. The payment domain onboarding doc covers it, and PR review catches violations.
- **Code review**: All payment-related PRs must be checked for float usage. A linter rule flags `float`/`double`/`number` types in files under `payments/`, `billing/`, and `subscriptions/` directories.
- **Type safety**: The `MonetaryAmount` value object makes it hard to accidentally pass raw floats into payment logic. If you're constructing a `MonetaryAmount`, you're passing an integer.
- **Database migration**: Existing `DECIMAL` and `FLOAT` columns were migrated to `BIGINT`. Migration was straightforward — multiply by 100, cast to integer, drop the old column. PR#1201 covers the schema changes.
- **Multi-currency**: Minor unit size varies by currency (JPY has no minor unit, BHD has 3 decimal places). The `MonetaryAmount` type uses ISO 4217 exponent metadata to handle this. For now we only support EUR and USD (both exponent 2), but the design accounts for future currencies.

## Alternatives Rejected

### BigDecimal / Decimal types

Languages like Java and Python have arbitrary-precision decimal types that avoid floating-point rounding. However, our stack spans TypeScript, Python, Go, and Kotlin. Each language's decimal type has different semantics, serialization behavior, and performance characteristics. Using integers is the lowest common denominator that works identically everywhere, including in JSON payloads and database schemas.

### Storing amounts as strings

Strings avoid floating-point issues, but they lose numeric ordering and arithmetic capabilities at the database level. You can't `SUM()` a string column. You can't `ORDER BY` it sensibly without a cast. Every arithmetic operation requires parse-compute-serialize, which is both slower and a source of bugs.
