## Why

Agent telemetry (`pipeline.agent_run_events` / `pipeline.agent_run_turns`) stored printed credentials verbatim. Twenty-seven rows across five runs contained GitHub installation tokens (`ghs_…`) or their base64 `x-access-token:…` HTTP Basic-auth form. Installation tokens expire within an hour so no stored copy is live, but the same ingest path would store a long-lived secret (API key, PAT in a local run) the same way — and the live run page streams these rows to anyone with UI access.

## What Changed

- Added a `basic-x-access-token` regex pattern to `redactSecrets()` in `libs/shared/src/lib/redact.ts` that catches `Authorization: Basic base64(x-access-token:ghs_…)` credentials. The encoded prefix `eC1hY2Nlc3MtdG9rZW46` is the fixed base64 of `x-access-token:`, which sits below the 100-character base64-blob floor that would otherwise catch it.
- Added a unit test in `libs/shared/src/lib/redact-secret-patterns.test.ts` that round-trips the encoding and verifies neither the raw token nor its base64 form survives `redactSecrets()`.

## Testing

Unit tests in `libs/shared` cover the new pattern: the test encodes a synthetic `ghs_…` token as `x-access-token:<token>` in base64, calls `redactSecrets()`, and asserts neither the token nor the encoded string appears in the output. The existing redaction test suite continues to pass.
