---
adr_number: 15
title: "Webhook-driven review reactor + prompt caching + business-hours cron"
status: accepted
date: 2026-04-17
domains: [agent, pipeline, review, cost, observability]
---

# ADR-015: Event-driven review reactor + cost optimizations

## Context

Three compounding cost issues surfaced in production:

1. **Polling waste.** `review_reactor` ran every 5 minutes whether or
   not anything had changed on a PR. Each tick checked every open
   Lore-managed PR against GitHub and woke Sonnet up to 3× per PR per
   review iteration — most ticks did nothing but still burned API
   quota and GitHub rate-limit budget.
2. **No prompt caching.** Every LLM call re-sent the full assembled
   context block (up to 16K tokens) uncached. Background jobs paid
   full input-token price on every call even when the system prompt
   was effectively static (consolidation, auto-curation).
3. **Over-sized context.** `assembleContext` defaulted to 16K tokens
   for every template, including implementation/review flows where
   the agent only needs conventions + the immediate diff.

A fourth latent bug: `LORE_WEBHOOK_SECRET` existed in Secret Manager
and had an ExternalSecret CR in the `mcp-servers` namespace, but was
never mounted into the pod — meaning `handleGitHubWebhook` always
returned `503 "webhook secret not configured"`. Any webhook path we
built on top would have silently failed signature validation.

## Decision

### 1. Event-driven reactor

Replace the 5-min poll with a GitHub webhook fan-out:

- `mcp-server` webhook handler accepts `pull_request`
  (`synchronize`, `opened`, `reopened`, `ready_for_review`),
  `pull_request_review` (`submitted`), and `issue_comment`
  (`created` on PRs). The spec-PR-merge path remains on
  `pull_request.closed` + merged.
- For qualifying events, mcp-server POSTs to the agent's new
  `POST /api/trigger/review-reactor` endpoint with
  `{repo, pr_number}` and a `LORE_AGENT_INTERNAL_TOKEN` bearer.
- The agent returns `202 Accepted` and runs `runReviewReactorForPR`
  in the background. No GitHub rate-limit hit unless something
  actually changed on the PR.

### 2. Business-hours safety cron

Primary trigger is the webhook; the cron exists only to catch PRs
whose webhook delivery was dropped. New schedule:
`7 7-17 * * 1-5` (hourly, Mon-Fri, UTC window covering CET/CEST
business hours), gated by `isBusinessHours()` which reads
`LORE_BUSINESS_HOURS_{TZ,START,END}` and `LORE_BUSINESS_DAYS`
(defaults: Europe/Berlin, 9, 18, Mon-Fri). Off-hours invocations
no-op. Webhook-triggered runs are never gated — they always proceed.

### 3. Prompt caching on agent LLM calls

`callLLM` and `callLLMWithTool` in `agent/src/anthropic.ts` now wrap
the system prompt in a single `TextBlockParam` carrying
`cache_control: {type: "ephemeral"}`. `response.usage.cache_*` fields
feed into cost accounting (1.25× writes, 0.1× reads). The raw fetch
call sites in mcp-server (graph extraction, fact extraction) have
static prefixes below Haiku's 2048-token cache minimum — caching
would not trigger, so they were not modified.

### 4. Per-template context budgets

`assembleContext`'s default dropped from 16K to 8K. Research keeps
16K (it's memory-heavy). Implementation/review/default cap at 8K.
The MCP tool's `max_tokens` parameter default also dropped to 8K.
Callers that need more ask for more.

### Alternatives considered

1. **LISTEN/NOTIFY via Postgres** — cleaner event transport but
   requires long-lived connections from both services and adds a
   new failure mode. HTTP POST with shared secret is already
   battle-tested in this codebase.
2. **Replace cron with webhook only (no safety net)** — one dropped
   webhook means a PR stalls until a human notices. A slow
   business-hours safety cron is nearly free and catches stragglers.
3. **Drop business-hours gating entirely** — the cron would still
   fire off-hours consuming GitHub API quota with no human around
   to benefit. Europe team ships during CET hours; off-hours ticks
   are pure waste.
4. **Chart.Yaml-level prompt caching (MCP side)** — ruled out
   because raw-fetch static prefixes are below the Haiku cache
   threshold. No savings.

## Consequences

**Positive:**
- Zero idle polls. Reactor fires only on actual state change.
- Review latency drops from avg ~2.5 min (half of 5-min poll
  interval) to seconds.
- Context tokens per task drop ~50% (16K → 8K default).
- System-prompt caching on background jobs amortizes repeated
  prefixes across calls.
- `LORE_WEBHOOK_SECRET` now actually validates signatures.

**Negative:**
- Two new env vars required on both services (`LORE_AGENT_URL`,
  `LORE_AGENT_INTERNAL_TOKEN`). Misconfiguration silently disables
  the webhook path — mcp-server logs a warning but accepts the
  webhook.
- Webhook deliveries can drop. Safety cron mitigates, but only
  during business hours.
- GitHub App must subscribe to `pull_request_review` + `issue_comment`
  in addition to existing `pull_request` and `issues` events.

## Operational notes

- **Helm gotcha**: `taskTypesConfig` was previously passed via
  `set { value = file(...) }`. Helm's CLI `set` parser splits on
  commas, which broke when `task-types.yaml` gained prose with
  commas. Switched to `values = [yamlencode({...})]` — passes the
  whole YAML document instead of a flattened key=value list.
  Apply to any future multi-line strings.
- **Secret rotation**: rotating `webhook_secret` requires ESO
  resync (`kubectl annotate externalsecret ... force-sync=...`)
  plus a pod restart (env-from-secret doesn't hot-reload).
  Simultaneously update the GitHub App webhook secret field.
