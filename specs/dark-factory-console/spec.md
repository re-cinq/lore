# Feature Specification: Dark Factory Console (web-ui)

| Field          | Value                                                                                   |
|----------------|-----------------------------------------------------------------------------------------|
| Feature        | Dark Factory Console                                                                     |
| Status         | In Progress                                                                                |
| Created        | 2026-06-12                                                                               |
| Owner          | Platform Engineering                                                                     |
| Decision       | extends [ADR-016](../../adrs/ADR-016-dark-factory-mode.md) — surfaces dark-factory operation in the UI |
| Consumes       | `lore.repos.settings.dark_factory` (resolved via `resolveDarkFactorySettings`), `pipeline.tasks`, `pipeline.audit_log` |

The Dark Factory Console adds a per-repo Dark Factory tab that honestly surfaces the two-gate activation state, the resolved settings, what the factory is currently working on, and a reverse-chronological decision feed of auto-merge, escalation, and lease audit events.

## Problem Statement

Dark-factory mode is fully built but barely visible. The only UI surface is a
five-stat card on the repo overview, and its "Enabled" badge reads **only** the
per-repo `dark_factory.enabled` flag — it ignores the cluster gate
(`LORE_DARK_FACTORY_CLUSTER_ENABLED`), so a repo can show **Enabled** while every
task still runs the legacy `claude --print` path. There is no way to see what
the factory is working on, why a PR auto-merged or deferred, or what the resolved
config actually is. The one operational fact the UI asserts is the one most
likely to be wrong.

## Solution

A dedicated **Dark Factory** tab per repo (`/repos/:owner/:repo/dark-factory`).
A pure deriver, `deriveDarkFactoryConsole`, folds the resolved settings, the
cluster gate, the repo's recent tasks, and its dark-factory audit events into a
view model; a presentational `DarkFactoryConsoleView` renders it (container/
presentational, data-down). The tab shows:

- **Effective activation** — the honest two-gate state: `active` only when the
  repo is enabled **and** the cluster gate is on; otherwise `inactive` (cluster
  gate off) or `disabled` (repo opted out), each with its reason.
- **Resolved config** — the full `ResolvedDarkFactorySettings` (auto-merge
  allowlist, `min_trust`, `require_*`, `create_issue`, `review`, `notify`) and
  the repo trust level.
- **What it works on** — recent tasks with type, status, and PR link.
- **Decision feed** — dark-factory audit events (auto-merge outcome + rule,
  escalations, lease takeovers, graph-ingest counts) in reverse-chronological
  order.

Enable/disable and config **editing** are out of scope here: privileged
`dark_factory` fields require the two-key CODEOWNERS-approval ceremony
(`dark-factory-authz`), which must not be bypassed via the web-ui DB write path.
The console is read-only; the write path is a separate, ceremony-routed change.

## Acceptance Criteria

The activation state is `active` only when the repo is enabled **and** the
cluster gate is on.
([validated by `is active when the repo is enabled`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L16))

When the repo is enabled but the cluster gate is off, the activation state is
`inactive` with a reason naming the platform cluster gate — so the console
never claims a repo is running dark-mode when the cluster gate would route it to
the legacy path.

When the repo is not enabled, the activation state is `disabled` regardless of
the cluster gate.
([validated by `is disabled when the repo is not enabled`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L22))

The model exposes the resolved config and trust level for display; the page
resolves an unconfigured trust level to `unset` and reads the raw
`dark_factory` settings block off the repo's settings (or `undefined` when
absent) before resolving it.
([validated by `exposes the resolved config and trust level`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L33), [`returns the configured trust level`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L77), [`returns unset when no trust level is configured`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L81), [`returns the dark_factory settings block`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L87), [`returns undefined when no dark_factory block is configured`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L93))

The page's reads of the tasks and audit-log APIs are best-effort: a result
that did not come back `ok` resolves to an empty list rather than failing the
page.
([validated by `returns the data when the result status is ok`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L11), [`returns the fallback when the result status is not ok`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L15))

Recent tasks are projected to work items carrying id, type, status, and PR link.
([validated by `projects recent tasks to work items with id, type, status, and PR link`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L40), [`stringifies the id and passes the rest through`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L21))

Dark-factory audit events are projected to a decision feed: an
`auto_merge_decision` summarizes its outcome, an `escalation_issued` its reason,
a `lease_expired` its previous holder, and a `spec_trace_ingest` its
validated_by / violated counts; an unrecognized event type falls back to its
raw event type, and a missing payload field falls back to a placeholder value.
A raw audit row with no payload normalizes to an empty object before it
reaches the deriver.
([validated by `projects audit events to a decision feed summarized by kind`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L63), [`falls back to the raw event type for an unrecognized kind`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L98), [`falls back to placeholder values when payload fields are missing`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/derive-console.test.ts#L113), [`defaults a missing payload to an empty object`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L45), [`passes an existing payload through unchanged`](apps/web-ui/src/app/repos/[owner]/[repo]/dark-factory/page-input.test.ts#L63))

## Out of Scope

- **Enable/disable + config editing** — a write path that must route through the
  mcp-server `PUT /api/repos/:o/:r/settings/dark-factory` two-key ceremony, not
  the web-ui DB path. Follow-up.
- Live streaming of stage commits (the per-task `Timeline` already covers a
  single task's stages).
