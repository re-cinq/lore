# Feature Specification: Job Log Streaming in Pipeline UI

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Job Log Streaming                        |
| Branch         | feat/job-log-streaming                   |
| Status         | In Progress                              |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 3-5 days                                 |

Job Log Streaming pipes a running task pod's stdout and stderr into the pipeline UI in near real time, giving developers progress and output for in-flight tasks instead of a bare running indicator that otherwise requires kubectl logs to inspect.

## Problem Statement

When a LoreTask Job runs, the only way to see what Claude Code is
doing is `kubectl logs`. Developers and platform engineers have no
visibility into running tasks from the Lore UI. They see "running"
and wait — no progress, no output, no indication if the agent is
stuck or making progress.

## Solution

Stream Job pod logs into the pipeline UI in real-time.

### Architecture

```
Job Pod → stdout/stderr
  ↓
Controller reads pod logs (on poll + on completion)
  ↓
Writes to LoreTask status.output (last 5000 chars, already exists)
  ↓
New: also writes to pipeline.task_events as log entries
  ↓
UI task detail page polls /api/pipeline/[id]/logs every 5s
  ↓
Renders log output in a scrollable terminal-style div
```

### What Changes

**1. Controller log streaming** (`agent/src/loretask-controller.ts`)

During `checkJob()`, when the LoreTask is in `Running` phase:
- Read pod logs (tail 100 lines)
- Patch LoreTask `status.output` with latest logs
- This happens every 15s via the poll loop (already exists)

**2. Watcher stores logs in DB** (`agent/src/jobs/loretask-watcher.ts`)

When watcher processes a Running LoreTask:
- Read `status.output` from the CR
- Store in a new `pipeline.task_logs` table or in `task_events` metadata
- The watcher already polls every minute

**3. API route** (`web-ui/src/app/api/pipeline/[id]/logs/route.ts`)

New server-side route:
- Reads task from DB
- If task has a LoreTask CR (implementation/review), read pod logs via K8s API
- Returns logs as plain text or JSON lines
- Supports `?since=<timestamp>` for incremental fetching

**4. UI component** (`web-ui/src/app/pipeline/[id]/TaskLogs.tsx`)

Client component:
- Polls `/api/pipeline/{id}/logs` every 5s while task is running
- Renders in a `<pre>` with monospace font, dark background
- Auto-scrolls to bottom
- Shows "Completed" or "Failed" header when task finishes
- Falls back to "No logs available" for non-CRD tasks

**5. Data storage option**

Option A: Store logs in `pipeline.task_events` with `to_status: 'log'`
Option B: New `pipeline.task_logs` table with `(task_id, timestamp, content)`
Option C: Read directly from K8s API (no DB storage, only works while pod exists)

Recommended: **Option C for live, Option A for historical**. While
the pod is running, read from K8s. After completion, the final output
is already stored in LoreTask `status.output` and transferred to
`task_events` by the watcher.

## Out of Scope

1. WebSocket streaming — polling is sufficient for Phase 0
2. Log search/filtering — just raw output
3. Log retention beyond task lifetime — cleaned up with LoreTask CR

## Acceptance Criteria

1. Running task shows live logs in pipeline detail page. ([validated by `TaskLogs.test.tsx:169`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L169))

2. Logs update on the task page's coordinated refresh (10s poll, or stream-driven when the task has a live assembly-line run) while the task is running. ([validated by `TaskLogs.test.tsx:527`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L527))

3. Completed/failed tasks show final output. ([validated by `TaskLogs.test.tsx:567`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L567))

4. No kubectl access needed to see what the agent is doing

## Component Contract

### TaskLogs viewer (turn-store cutover, 2026-08)

The viewer reads the task's stored agent turns (`pipeline.agent_run_turns`) through the logs proxy — the GCS byte log it replaced had no cluster-side writer left (#1292) — and its initial fetch requests the page-limit URL with no `after` cursor. ([validated by `TaskLogs.test.tsx:152`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L152))

The mount fetch fires exactly once — a response that settles new state must not re-fire it, so incremental refreshes happen only on the page coordinator's ticks. ([validated by `TaskLogs.test.tsx:741`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L741))

Before any turns resolve — or while a task that has not finished has no stored turns yet — the viewer shows the placeholder "Logs will appear when the agent starts.", and the "Agent Output" heading always renders. ([validated by `TaskLogs.test.tsx:134`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L134), [validated by `TaskLogs.test.tsx:648`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L648), [validated by `TaskLogs.test.tsx:587`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L587))

A task past its queued/running phases (including badge-less settled statuses like needs-human-help) with zero stored turns shows the no-stored-turns explainer — naming direct-API task types (onboard/feature-request produce no transcript), locally-run tasks (no ingest yet), tasks that ran before the transcript store, and the 30-day retention — instead of the placeholder; the copy stays a present-tense availability statement, never a claim that nothing was recorded. ([validated by `TaskLogs.test.tsx:632`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L632), [validated by `TaskLogs.test.tsx:835`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L835))

Status maps to a badge: "Completed" for succeeded/pr-created/merged, "In Review" for review, "Failed" for failed/cancelled; a running task that later reports completion transitions from the polling note to the Completed badge. ([validated by `TaskLogs.test.tsx:187`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L187), [validated by `TaskLogs.test.tsx:201`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L201), [validated by `TaskLogs.test.tsx:215`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L215), [validated by `TaskLogs.test.tsx:227`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L227), [validated by `TaskLogs.test.tsx:239`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L239), [validated by `TaskLogs.test.tsx:251`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L251), [validated by `TaskLogs.test.tsx:599`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L599))

While running, the viewer renders a pulse indicator and a refresh note — "Live" when the run event stream is attached, "Auto-refreshing" otherwise — suffixed with "— N turns received" once turns have arrived and bare at zero turns. ([validated by `TaskLogs.test.tsx:265`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L265), [validated by `TaskLogs.test.tsx:289`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L289))

Once the first page landed, the coordinator's polls request `after=<last row id>` and append only the returned turns; a poll returning nothing new appends nothing and duplicates nothing, and an in-flight latch keeps overlapping walks from double-appending. ([validated by `TaskLogs.test.tsx:302`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L302), [validated by `TaskLogs.test.tsx:347`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L347))

The walk continues within the same fetch cycle while the Floor's explicit `hasMore` flag says more rows follow — falling back to the page-length rule (a page of exactly the page limit continues, a shorter one stops) only when the response carries no boolean flag, so a Floor clamp drifting below the client's page size can no longer silently truncate a settled task's transcript (#1310) — and stops at the run page's turn load cap, at a per-walk page bound that keeps a drifted clamp from turning one walk into a request storm (showing the cap notice exactly when the walk stopped while the server still reported more, and suppressing it when the walk drained even at the cap boundary), or when a page fails to advance the cursor (which would otherwise refetch itself forever). ([validated by `TaskLogs.test.tsx:374`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L374), [validated by `TaskLogs.test.tsx:798`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L798), [validated by `TaskLogs.test.tsx:876`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L876), [validated by `TaskLogs.test.tsx:915`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L915), [validated by `TaskLogs.test.tsx:931`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L931), [validated by `task-logs-presenter.test.ts:70`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L70), [validated by `task-logs-presenter.test.ts:74`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L74), [validated by `task-logs-presenter.test.ts:80`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L80), [validated by `task-logs-presenter.test.ts:84`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L84), [validated by `task-logs-presenter.test.ts:156`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L156), [validated by `task-logs-presenter.test.ts:160`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L160), [validated by `task-logs-presenter.test.ts:166`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L166), [validated by `task-logs-presenter.test.ts:173`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L173), [validated by `TaskLogs.test.tsx:956`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L956), [validated by `TaskLogs.test.tsx:974`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L974))

The cap bounds the tab's memory across the task's whole lifetime, not one walk: once the cap is loaded, later poll ticks fetch nothing more and the capped notice is shown. ([validated by `TaskLogs.test.tsx:763`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L763))

The X-Task-Status header is read before the ok-check, so a failing upstream still settles the badge and ends the poll loop of a completed task. ([validated by `TaskLogs.test.tsx:814`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L814))

The poll cursor survives hostile pages — it advances to the last row carrying a string id and stays put over an empty or id-less page — and the logs URL carries the page limit, the encoded task id, and the cursor. ([validated by `task-logs-presenter.test.ts:52`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L52), [validated by `task-logs-presenter.test.ts:56`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L56), [validated by `task-logs-presenter.test.ts:60`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L60), [validated by `task-logs-presenter.test.ts:64`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L64), [validated by `task-logs-presenter.test.ts:32`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L32), [validated by `task-logs-presenter.test.ts:38`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L38), [validated by `task-logs-presenter.test.ts:44`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L44))

Fetch failures surface distinct messages: a 403 renders the access-denied message and stops polling, a 401 renders the sign-in message, any other non-ok response renders an "HTTP <code>" message, a thrown fetch renders the rejection message, and a later successful fetch clears the error. ([validated by `TaskLogs.test.tsx:404`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L404), [validated by `TaskLogs.test.tsx:436`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L436), [validated by `TaskLogs.test.tsx:455`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L455), [validated by `TaskLogs.test.tsx:472`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L472), [validated by `TaskLogs.test.tsx:489`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L489))

### Logs proxy (`/api/tasks/[id]/logs`)

The logs route is a session-authed proxy to the Floor's task-keyed turn route `GET /api/agent-turns/task/{taskId}`, with the run-page turns proxy's auth ladder: session (401) → task lookup (upstream code preserved, so a lore-api 500 does not render as "not found") → repo access (403) → env guard (500). ([validated by `route.test.ts:50`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L50), [validated by `route.test.ts:59`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L59), [validated by `route.test.ts:73`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L73), [validated by `route.test.ts:87`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L87))

The proxy forwards `after`/`limit` untouched, sends `LORE_INGEST_TOKEN` as the bearer, propagates the request's abort signal, returns the Floor's status and body verbatim — except the Floor's own 401/403 (a rotated or mismatched ingest token), which surface as 502 so they cannot masquerade as the proxy's session/repo-access ladder — and opts out of route caching. ([validated by `route.test.ts:45`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L45), [validated by `route.test.ts:98`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L98), [validated by `route.test.ts:108`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L108), [validated by `route.test.ts:118`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L118), [validated by `route.test.ts:129`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L129), [validated by `route.test.ts:137`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L137), [validated by `route.test.ts:146`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L146), [validated by `route.test.ts:166`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L166), [validated by `route.test.ts:178`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L178))

The task's recorded status rides the `X-Task-Status` response header — the viewer's badge and poll gate need it, the turn rows do not carry it, and merging it into the body would break the byte-for-byte pass-through. ([validated by `route.test.ts:158`](apps/web-ui/src/app/api/tasks/[id]/logs/route.test.ts#L158))

### Readable transcript rendering (2026-07)

Both log viewers — the task detail viewer and the per-node assembly-line pod-log panels — parse an NDJSON stream line by line and render a human-readable transcript instead of the raw JSON blob, with a line that cannot be parsed as JSON shown raw, and a Raw/Formatted toggle (formatted by default) preserving access to the underlying stream (the pod's verbatim bytes for the pod-log panels; the stored turn envelopes re-serialized one per line for the task viewer); the parser is grounded in real production lines captured from a live review node (`agent-log-entries.fixtures.ts`). ([validated by `agent-log-entries.test.ts:231`](apps/web-ui/src/lib/agent-log-entries.test.ts#L231))

#### Parsing (`agent-log-entries.ts`)

Each NDJSON line of an agent pod's stream parses into a typed entry; empty lines are skipped and an empty blob yields no entries. ([validated by `agent-log-entries.test.ts:34`](apps/web-ui/src/lib/agent-log-entries.test.ts#L34))

A line that is not JSON — a runner/supervisor marker or an unterminated fragment from an in-flight poll — passes through verbatim as a raw entry, as does valid JSON of an unrecognized shape. ([validated by `agent-log-entries.test.ts:39`](apps/web-ui/src/lib/agent-log-entries.test.ts#L39), [validated by `agent-log-entries.test.ts:45`](apps/web-ui/src/lib/agent-log-entries.test.ts#L45), [validated by `agent-log-entries.test.ts:204`](apps/web-ui/src/lib/agent-log-entries.test.ts#L204))

Lifecycle markers become status entries, carrying the exit code when present. ([validated by `agent-log-entries.test.ts:51`](apps/web-ui/src/lib/agent-log-entries.test.ts#L51))

The system init line becomes a session-init entry exposing the model, the Claude Code version, and the pretty-printed full payload. ([validated by `agent-log-entries.test.ts:60`](apps/web-ui/src/lib/agent-log-entries.test.ts#L60))

Consecutive thinking_tokens ticker lines coalesce into a single counter entry holding the run's latest count; a run broken by any other entry starts a new counter. ([validated by `agent-log-entries.test.ts:73`](apps/web-ui/src/lib/agent-log-entries.test.ts#L73), [validated by `agent-log-entries.test.ts:85`](apps/web-ui/src/lib/agent-log-entries.test.ts#L85))

Assistant and user messages emit one entry per content block — thinking, text, and tool_use — in order. ([validated by `agent-log-entries.test.ts:100`](apps/web-ui/src/lib/agent-log-entries.test.ts#L100), [validated by `agent-log-entries.test.ts:109`](apps/web-ui/src/lib/agent-log-entries.test.ts#L109), [validated by `agent-log-entries.test.ts:210`](apps/web-ui/src/lib/agent-log-entries.test.ts#L210))

A tool_use block is summarized as `→ <tool>: <most relevant arg>`, falling back to the bare tool name when no recognized text argument is present. ([validated by `agent-log-entries.test.ts:118`](apps/web-ui/src/lib/agent-log-entries.test.ts#L118), [validated by `agent-log-entries.test.ts:127`](apps/web-ui/src/lib/agent-log-entries.test.ts#L127))

A tool_result block yields its text — string or array form, tool references bracketed — with is_error preserved and real newlines kept. ([validated by `agent-log-entries.test.ts:133`](apps/web-ui/src/lib/agent-log-entries.test.ts#L133), [validated by `agent-log-entries.test.ts:139`](apps/web-ui/src/lib/agent-log-entries.test.ts#L139), [validated by `agent-log-entries.test.ts:148`](apps/web-ui/src/lib/agent-log-entries.test.ts#L148))

User text blocks (the injected task prompt) become user-text entries. ([validated by `agent-log-entries.test.ts:154`](apps/web-ui/src/lib/agent-log-entries.test.ts#L154))

The terminal result line yields a result entry with the agent text, error flag, duration, cost and turn count; a station's LORE_NODE_RESULT text is kept verbatim. ([validated by `agent-log-entries.test.ts:163`](apps/web-ui/src/lib/agent-log-entries.test.ts#L163), [validated by `agent-log-entries.test.ts:182`](apps/web-ui/src/lib/agent-log-entries.test.ts#L182))

Station eventLine progress lines become station-log entries. ([validated by `agent-log-entries.test.ts:176`](apps/web-ui/src/lib/agent-log-entries.test.ts#L176))

Lines wrapped in the ai-agent-subsystem's attribution envelope — single or the transitional double wrap — classify identically to their bare payload. ([validated by `agent-log-entries.test.ts:192`](apps/web-ui/src/lib/agent-log-entries.test.ts#L192), [validated by `agent-log-entries.test.ts:198`](apps/web-ui/src/lib/agent-log-entries.test.ts#L198))

The captured production sample parses into the expected ordered kind sequence with one counter per ticker run. ([validated by `agent-log-entries.test.ts:231`](apps/web-ui/src/lib/agent-log-entries.test.ts#L231))

formatTokens abbreviates counts of a thousand or more with a `k` suffix, formatDuration renders the two largest time units, and clip flattens whitespace and truncates with an ellipsis. ([validated by `agent-log-entries.test.ts:255`](apps/web-ui/src/lib/agent-log-entries.test.ts#L255), [validated by `agent-log-entries.test.ts:263`](apps/web-ui/src/lib/agent-log-entries.test.ts#L263), [validated by `agent-log-entries.test.ts:271`](apps/web-ui/src/lib/agent-log-entries.test.ts#L271))

#### Rendering (`LogEntriesView`)

Lifecycle and station-log entries render as dimmed `·` lines, with the exit code appended when present. ([validated by `LogEntriesView.test.tsx:15`](apps/web-ui/src/components/LogEntriesView.test.tsx#L15), [validated by `LogEntriesView.test.tsx:23`](apps/web-ui/src/components/LogEntriesView.test.tsx#L23), [validated by `LogEntriesView.test.tsx:111`](apps/web-ui/src/components/LogEntriesView.test.tsx#L111))

The session-init entry renders as a collapsed details block whose summary names the model and Claude Code version. ([validated by `LogEntriesView.test.tsx:33`](apps/web-ui/src/components/LogEntriesView.test.tsx#L33))

The thinking-tokens counter renders italic-dimmed as `thinking… ~N tokens`, and tool summaries render with the accent class. ([validated by `LogEntriesView.test.tsx:47`](apps/web-ui/src/components/LogEntriesView.test.tsx#L47), [validated by `LogEntriesView.test.tsx:57`](apps/web-ui/src/components/LogEntriesView.test.tsx#L57))

A short single-line tool result renders inline; a long or multiline one collapses into an expandable details block carrying the error class when is_error. ([validated by `LogEntriesView.test.tsx:65`](apps/web-ui/src/components/LogEntriesView.test.tsx#L65), [validated by `LogEntriesView.test.tsx:82`](apps/web-ui/src/components/LogEntriesView.test.tsx#L82))

The terminal result renders a summary footer with duration, cost and turn count — or `✗ failed` carrying the error class — with the result text expandable. ([validated by `LogEntriesView.test.tsx:92`](apps/web-ui/src/components/LogEntriesView.test.tsx#L92), [validated by `LogEntriesView.test.tsx:101`](apps/web-ui/src/components/LogEntriesView.test.tsx#L101))

The user prompt renders as collapsed details prefixed `user:`. ([validated by `LogEntriesView.test.tsx:123`](apps/web-ui/src/components/LogEntriesView.test.tsx#L123))

Raw entries render verbatim; assistant text and thinking render with their own classes. ([validated by `LogEntriesView.test.tsx:140`](apps/web-ui/src/components/LogEntriesView.test.tsx#L140), [validated by `LogEntriesView.test.tsx:152`](apps/web-ui/src/components/LogEntriesView.test.tsx#L152))

The Raw/Formatted toggle marks the active option via aria-pressed and reports changes through onChange. ([validated by `LogFormatToggle.test.tsx:7`](apps/web-ui/src/components/LogFormatToggle.test.tsx#L7), [validated by `LogFormatToggle.test.tsx:28`](apps/web-ui/src/components/LogFormatToggle.test.tsx#L28))

#### Viewer integration

The task log viewer renders the parsed transcript by default — tool lines, one counter per ticker run, the result footer — with no raw JSON visible. ([validated by `TaskLogs.test.tsx:664`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L664))

Clicking Raw shows the stored stream — each turn's envelope re-serialized as one NDJSON line — and clicking Formatted restores the transcript; the toggle is hidden until turns arrive. ([validated by `TaskLogs.test.tsx:708`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L708), [validated by `TaskLogs.test.tsx:727`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L727))

A task's turns span every node visit of its assembly line, so the formatted view renders one segment per consecutive (node, iteration) run — labeled `node · iteration N`, bare node name when the iteration is unknown, no label for uncorrelated turns — and the parser runs per segment so each visit keeps its own transcript. ([validated by `TaskLogs.test.tsx:683`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L683), [validated by `task-logs-presenter.test.ts:92`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L92), [validated by `task-logs-presenter.test.ts:107`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L107), [validated by `task-logs-presenter.test.ts:121`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L121), [validated by `task-logs-presenter.test.ts:130`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L130), [validated by `task-logs-presenter.test.ts:136`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L136), [validated by `task-logs-presenter.test.ts:142`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L142), [validated by `task-logs-presenter.test.ts:148`](apps/web-ui/src/app/tasks/[id]/task-logs-presenter.test.ts#L148))

An opened assembly-line pod-log panel renders the same formatted transcript, switches to the raw blob via the toggle, and keeps the `(no output yet)` placeholder for empty logs. ([validated by `NodeLogPanel.test.tsx:67`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L67), [validated by `NodeLogPanel.test.tsx:81`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L81), [validated by `NodeLogPanel.test.tsx:95`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L95))

### FailurePanel

FailurePanel renders nothing when the metadata carries neither an error nor any detail rows — undefined fields, an empty details array, or undefined metadata. ([validated by `FailurePanel.test.tsx:9`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L9), [validated by `FailurePanel.test.tsx:15`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L15), [validated by `FailurePanel.test.tsx:23`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L23))

A top-level error renders the "Failure" heading and the error paragraph; detail rows alone, with no top-level error, still render the heading and their error text. ([validated by `FailurePanel.test.tsx:34`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L34), [validated by `FailurePanel.test.tsx:162`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L162))

The category badge maps a known code to its human label, falls back to the raw code string when unmapped, shows "Unknown" for the reserved `unknown` code, and is omitted entirely when no category is present. ([validated by `FailurePanel.test.tsx:42`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L42), [validated by `FailurePanel.test.tsx:52`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L52), [validated by `FailurePanel.test.tsx:177`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L177), [validated by `FailurePanel.test.tsx:62`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L62))

A remediation hint renders under a "How to fix:" label and is omitted when no hint is provided. ([validated by `FailurePanel.test.tsx:70`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L70), [validated by `FailurePanel.test.tsx:81`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L81))

Error text is linkified — a file path inside the top-level error becomes a GitHub blob link opening in a new tab. ([validated by `FailurePanel.test.tsx:86`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L86))

Per-step detail rows render the step code with its own category badge, error, and linkified hint; the badge and hint are omitted when a detail lacks them, and multiple rows preserve their declared order. ([validated by `FailurePanel.test.tsx:102`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L102), [validated by `FailurePanel.test.tsx:129`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L129), [validated by `FailurePanel.test.tsx:143`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L143))
