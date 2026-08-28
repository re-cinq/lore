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

## Amendment (2026-08-28, #1608)

The task-page "Agent Output" viewer (`TaskLogs`), its presenter, and the
`/api/tasks/[id]/logs` proxy were removed: the task page is now the
lifecycle shell only, and every transcript surface lives on the run
detail page — the per-node pod-log panels and the full transcript panel
(specs/turn-level-transcript-store FR5), reached from the task's runs
list (or directly, since a single-run task redirects there). The
parsing/rendering layer below survives unchanged; it was always shared
with the run page.

## Acceptance Criteria

1. A running task's live output is one click from the task page: the
   runs list links to the run detail page, whose per-node panels render
   the pod stream. ([validated by `NodeLogPanel.test.tsx:67`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L67))

2. No kubectl access needed to see what the agent is doing

## Component Contract

### Readable transcript rendering (2026-07)

The run page's log viewers — the per-node assembly-line pod-log panels and the full transcript panel — parse an NDJSON stream line by line and render a human-readable transcript instead of the raw JSON blob, with a line that cannot be parsed as JSON shown raw, and a Raw/Formatted toggle (formatted by default) preserving access to the underlying stream (the pod's verbatim bytes for the pod-log panels; the stored turn envelopes for the transcript panel); the parser is grounded in real production lines captured from a live review node (`agent-log-entries.fixtures.ts`). ([validated by `agent-log-entries.test.ts:237`](apps/web-ui/src/lib/agent-log-entries.test.ts#L237))

#### Parsing (`agent-log-entries.ts`)

Each NDJSON line of an agent pod's stream parses into a typed entry; empty lines are skipped and an empty blob yields no entries. ([validated by `agent-log-entries.test.ts:40`](apps/web-ui/src/lib/agent-log-entries.test.ts#L40))

`parseAgentLog` is built on two smaller exports the run page's timestamped conversation reuses — `parseAgentLogLine` classifies one line, and `logEntriesFromValue` classifies an already-decoded envelope without re-serializing it, since the transcript store hands out parsed JSONB — sharing the same ticker-collapse rule, `supersedesPrevious`, so a run of `thinking_tokens` entries collapses identically whether it crosses lines in one blob or turns in the timed view. ([validated by `agent-log-entries.test.ts:284`](apps/web-ui/src/lib/agent-log-entries.test.ts#L284), [`agent-log-entries.test.ts:288`](apps/web-ui/src/lib/agent-log-entries.test.ts#L288), [`agent-log-entries.test.ts:294`](apps/web-ui/src/lib/agent-log-entries.test.ts#L294), [`agent-log-entries.test.ts:302`](apps/web-ui/src/lib/agent-log-entries.test.ts#L302), [`agent-log-entries.test.ts:310`](apps/web-ui/src/lib/agent-log-entries.test.ts#L310), [`agent-log-entries.test.ts:318`](apps/web-ui/src/lib/agent-log-entries.test.ts#L318))

A line that is not JSON — a runner/supervisor marker or an unterminated fragment from an in-flight poll — passes through verbatim as a raw entry, as does valid JSON of an unrecognized shape. ([validated by `agent-log-entries.test.ts:45`](apps/web-ui/src/lib/agent-log-entries.test.ts#L45), [validated by `agent-log-entries.test.ts:51`](apps/web-ui/src/lib/agent-log-entries.test.ts#L51), [validated by `agent-log-entries.test.ts:210`](apps/web-ui/src/lib/agent-log-entries.test.ts#L210))

Lifecycle markers become status entries, carrying the exit code when present. ([validated by `agent-log-entries.test.ts:57`](apps/web-ui/src/lib/agent-log-entries.test.ts#L57))

A lifecycle marker's `phase` is carried on the entry, so a phase like `init` reads as `· init started` instead of falling back to the unclassified default; a marker with no phase keeps the bare `· agent <status>` line. ([validated by `agent-log-entries.test.ts:330`](apps/web-ui/src/lib/agent-log-entries.test.ts#L330), [`agent-log-entries.test.ts:336`](apps/web-ui/src/lib/agent-log-entries.test.ts#L336), [`LogEntriesView.test.tsx:29`](apps/web-ui/src/components/LogEntriesView.test.tsx#L29))

The system init line becomes a session-init entry exposing the model, the Claude Code version, and the pretty-printed full payload. ([validated by `agent-log-entries.test.ts:66`](apps/web-ui/src/lib/agent-log-entries.test.ts#L66))

Consecutive thinking_tokens ticker lines coalesce into a single counter entry holding the run's latest count; a run broken by any other entry starts a new counter. ([validated by `agent-log-entries.test.ts:79`](apps/web-ui/src/lib/agent-log-entries.test.ts#L79), [validated by `agent-log-entries.test.ts:91`](apps/web-ui/src/lib/agent-log-entries.test.ts#L91))

Assistant and user messages emit one entry per content block — thinking, text, and tool_use — in order. ([validated by `agent-log-entries.test.ts:106`](apps/web-ui/src/lib/agent-log-entries.test.ts#L106), [validated by `agent-log-entries.test.ts:115`](apps/web-ui/src/lib/agent-log-entries.test.ts#L115), [validated by `agent-log-entries.test.ts:216`](apps/web-ui/src/lib/agent-log-entries.test.ts#L216))

A tool_use block is summarized as `→ <tool>: <most relevant arg>`, falling back to the bare tool name when no recognized text argument is present. ([validated by `agent-log-entries.test.ts:124`](apps/web-ui/src/lib/agent-log-entries.test.ts#L124), [validated by `agent-log-entries.test.ts:133`](apps/web-ui/src/lib/agent-log-entries.test.ts#L133))

A tool_result block yields its text — string or array form, tool references bracketed — with is_error preserved and real newlines kept. ([validated by `agent-log-entries.test.ts:139`](apps/web-ui/src/lib/agent-log-entries.test.ts#L139), [validated by `agent-log-entries.test.ts:145`](apps/web-ui/src/lib/agent-log-entries.test.ts#L145), [validated by `agent-log-entries.test.ts:154`](apps/web-ui/src/lib/agent-log-entries.test.ts#L154))

User text blocks (the injected task prompt) become user-text entries. ([validated by `agent-log-entries.test.ts:160`](apps/web-ui/src/lib/agent-log-entries.test.ts#L160))

The terminal result line yields a result entry with the agent text, error flag, duration, cost and turn count; a station's LORE_NODE_RESULT text is kept verbatim. ([validated by `agent-log-entries.test.ts:169`](apps/web-ui/src/lib/agent-log-entries.test.ts#L169), [validated by `agent-log-entries.test.ts:188`](apps/web-ui/src/lib/agent-log-entries.test.ts#L188))

Station eventLine progress lines become station-log entries. ([validated by `agent-log-entries.test.ts:182`](apps/web-ui/src/lib/agent-log-entries.test.ts#L182))

A `rate_limit_event` line becomes a rate-limit entry naming every window's whole-percent utilization, reset time and status, reading `unifiedWindows` when present and falling back to the single top-level window otherwise; a shape carrying no readable window is kept raw rather than rendering a confidently empty sentence. `utilization` is the fraction the event sends, never treated as an already-computed percent. ([validated by `agent-log-entries.test.ts:344`](apps/web-ui/src/lib/agent-log-entries.test.ts#L344), [`agent-log-entries.test.ts:357`](apps/web-ui/src/lib/agent-log-entries.test.ts#L357), [`agent-log-entries.test.ts:379`](apps/web-ui/src/lib/agent-log-entries.test.ts#L379), [`agent-log-entries.test.ts:385`](apps/web-ui/src/lib/agent-log-entries.test.ts#L385), [`agent-log-entries.test.ts:408`](apps/web-ui/src/lib/agent-log-entries.test.ts#L408), [`agent-log-entries.test.ts:416`](apps/web-ui/src/lib/agent-log-entries.test.ts#L416), [`agent-log-entries.test.ts:431`](apps/web-ui/src/lib/agent-log-entries.test.ts#L431), [`LogEntriesView.test.tsx:39`](apps/web-ui/src/components/LogEntriesView.test.tsx#L39))

Lines wrapped in the ai-agent-subsystem's attribution envelope — single or the transitional double wrap — classify identically to their bare payload. ([validated by `agent-log-entries.test.ts:198`](apps/web-ui/src/lib/agent-log-entries.test.ts#L198), [validated by `agent-log-entries.test.ts:204`](apps/web-ui/src/lib/agent-log-entries.test.ts#L204))

The captured production sample parses into the expected ordered kind sequence with one counter per ticker run. ([validated by `agent-log-entries.test.ts:237`](apps/web-ui/src/lib/agent-log-entries.test.ts#L237))

formatTokens abbreviates counts of a thousand or more with a `k` suffix, formatDuration renders the two largest time units, and clip flattens whitespace and truncates with an ellipsis. ([validated by `agent-log-entries.test.ts:261`](apps/web-ui/src/lib/agent-log-entries.test.ts#L261), [validated by `agent-log-entries.test.ts:269`](apps/web-ui/src/lib/agent-log-entries.test.ts#L269), [validated by `agent-log-entries.test.ts:277`](apps/web-ui/src/lib/agent-log-entries.test.ts#L277))

#### Rendering (`LogEntriesView`)

Lifecycle and station-log entries render as dimmed `·` lines, with the exit code appended when present. ([validated by `LogEntriesView.test.tsx:15`](apps/web-ui/src/components/LogEntriesView.test.tsx#L15), [validated by `LogEntriesView.test.tsx:56`](apps/web-ui/src/components/LogEntriesView.test.tsx#L56), [validated by `LogEntriesView.test.tsx:144`](apps/web-ui/src/components/LogEntriesView.test.tsx#L144))

The session-init entry renders as a collapsed details block whose summary names the model and Claude Code version. ([validated by `LogEntriesView.test.tsx:66`](apps/web-ui/src/components/LogEntriesView.test.tsx#L66))

The thinking-tokens counter renders italic-dimmed as `thinking… ~N tokens`, and tool summaries render with the accent class. ([validated by `LogEntriesView.test.tsx:80`](apps/web-ui/src/components/LogEntriesView.test.tsx#L80), [validated by `LogEntriesView.test.tsx:90`](apps/web-ui/src/components/LogEntriesView.test.tsx#L90))

A short single-line tool result renders inline; a long or multiline one collapses into an expandable details block carrying the error class when is_error. ([validated by `LogEntriesView.test.tsx:98`](apps/web-ui/src/components/LogEntriesView.test.tsx#L98), [validated by `LogEntriesView.test.tsx:115`](apps/web-ui/src/components/LogEntriesView.test.tsx#L115))

The terminal result renders a summary footer with duration, cost and turn count — or `✗ failed` carrying the error class — with the result text expandable. ([validated by `LogEntriesView.test.tsx:125`](apps/web-ui/src/components/LogEntriesView.test.tsx#L125), [validated by `LogEntriesView.test.tsx:134`](apps/web-ui/src/components/LogEntriesView.test.tsx#L134))

The user prompt renders as collapsed details prefixed `user:`. ([validated by `LogEntriesView.test.tsx:156`](apps/web-ui/src/components/LogEntriesView.test.tsx#L156))

Raw entries render verbatim; assistant text and thinking render with their own classes. ([validated by `LogEntriesView.test.tsx:173`](apps/web-ui/src/components/LogEntriesView.test.tsx#L173), [validated by `LogEntriesView.test.tsx:185`](apps/web-ui/src/components/LogEntriesView.test.tsx#L185))

The Raw/Formatted toggle marks the active option via aria-pressed and reports changes through onChange. ([validated by `LogFormatToggle.test.tsx:7`](apps/web-ui/src/components/LogFormatToggle.test.tsx#L7), [validated by `LogFormatToggle.test.tsx:28`](apps/web-ui/src/components/LogFormatToggle.test.tsx#L28))

#### Viewer integration

A run's turns span every node visit of its assembly line, so the formatted transcript renders one segment per consecutive (node, iteration) run — labeled `node · iteration N`, bare node name when the iteration is unknown, no label for uncorrelated turns — and the parser runs per segment so each visit keeps its own transcript, via the grouping in `@/lib/turn-segments` consumed by the run page's full transcript panel (specs/turn-level-transcript-store FR5). ([validated by `turn-segments.test.ts:31`](apps/web-ui/src/lib/turn-segments.test.ts#L31), [validated by `turn-segments.test.ts:46`](apps/web-ui/src/lib/turn-segments.test.ts#L46), [validated by `turn-segments.test.ts:60`](apps/web-ui/src/lib/turn-segments.test.ts#L60), [validated by `turn-segments.test.ts:69`](apps/web-ui/src/lib/turn-segments.test.ts#L69), [validated by `turn-segments.test.ts:75`](apps/web-ui/src/lib/turn-segments.test.ts#L75), [validated by `turn-segments.test.ts:79`](apps/web-ui/src/lib/turn-segments.test.ts#L79), [validated by `turn-segments.test.ts:83`](apps/web-ui/src/lib/turn-segments.test.ts#L83), [validated by `turn-segments.test.ts:91`](apps/web-ui/src/lib/turn-segments.test.ts#L91), [validated by `turn-segments.test.ts:104`](apps/web-ui/src/lib/turn-segments.test.ts#L104))

An opened assembly-line pod-log panel renders the same formatted transcript, switches to the raw blob via the toggle, and keeps the `(no output yet)` placeholder for empty logs. ([validated by `NodeLogPanel.test.tsx:67`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L67), [validated by `NodeLogPanel.test.tsx:81`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L81), [validated by `NodeLogPanel.test.tsx:95`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L95))

### FailurePanel

FailurePanel renders nothing when the metadata carries neither an error nor any detail rows — undefined fields, an empty details array, or undefined metadata. ([validated by `FailurePanel.test.tsx:9`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L9), [validated by `FailurePanel.test.tsx:15`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L15), [validated by `FailurePanel.test.tsx:23`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L23))

A top-level error renders the "Failure" heading and the error paragraph; detail rows alone, with no top-level error, still render the heading and their error text. ([validated by `FailurePanel.test.tsx:34`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L34), [validated by `FailurePanel.test.tsx:162`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L162))

The category badge maps a known code to its human label, falls back to the raw code string when unmapped, shows "Unknown" for the reserved `unknown` code, and is omitted entirely when no category is present. ([validated by `FailurePanel.test.tsx:42`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L42), [validated by `FailurePanel.test.tsx:52`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L52), [validated by `FailurePanel.test.tsx:177`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L177), [validated by `FailurePanel.test.tsx:62`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L62))

A remediation hint renders under a "How to fix:" label and is omitted when no hint is provided. ([validated by `FailurePanel.test.tsx:70`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L70), [validated by `FailurePanel.test.tsx:81`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L81))

Error text is linkified — a file path inside the top-level error becomes a GitHub blob link opening in a new tab. ([validated by `FailurePanel.test.tsx:86`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L86))

Per-step detail rows render the step code with its own category badge, error, and linkified hint; the badge and hint are omitted when a detail lacks them, and multiple rows preserve their declared order. ([validated by `FailurePanel.test.tsx:102`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L102), [validated by `FailurePanel.test.tsx:129`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L129), [validated by `FailurePanel.test.tsx:143`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L143))
