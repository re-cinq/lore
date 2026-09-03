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

The run page's log viewers — the per-node assembly-line pod-log panels and the full transcript panel — parse an NDJSON stream line by line and render a human-readable transcript instead of the raw JSON blob, with a line that cannot be parsed as JSON shown raw, and a Raw/Formatted toggle (formatted by default) preserving access to the underlying stream (the pod's verbatim bytes for the pod-log panels; the stored turn envelopes for the transcript panel); the parser is grounded in real production lines captured from a live review node (`agent-log-entries.fixtures.ts`). ([validated by `agent-log-entries.test.ts:239`](apps/web-ui/src/lib/agent-log-entries.test.ts#L260))

#### Parsing (`agent-log-entries.ts`)

Each NDJSON line of an agent pod's stream parses into a typed entry; empty lines are skipped and an empty blob yields no entries. ([validated by `agent-log-entries.test.ts:40`](apps/web-ui/src/lib/agent-log-entries.test.ts#L63))

`parseAgentLog` is built on two smaller exports the run page's timestamped conversation reuses — `parseAgentLogLine` classifies one line, and `logEntriesFromValue` classifies an already-decoded envelope without re-serializing it, since the transcript store hands out parsed JSONB — sharing the same ticker-collapse rule, `supersedesPrevious`, so a run of `thinking_tokens` entries collapses identically whether it crosses lines in one blob or turns in the timed view. ([validated by `agent-log-entries.test.ts:286`](apps/web-ui/src/lib/agent-log-entries.test.ts#L307), [`agent-log-entries.test.ts:290`](apps/web-ui/src/lib/agent-log-entries.test.ts#L311), [`agent-log-entries.test.ts:296`](apps/web-ui/src/lib/agent-log-entries.test.ts#L317), [`agent-log-entries.test.ts:304`](apps/web-ui/src/lib/agent-log-entries.test.ts#L325), [`agent-log-entries.test.ts:312`](apps/web-ui/src/lib/agent-log-entries.test.ts#L333), [`agent-log-entries.test.ts:320`](apps/web-ui/src/lib/agent-log-entries.test.ts#L341))

A line that is not JSON — a runner/supervisor marker or an unterminated fragment from an in-flight poll — passes through verbatim as a raw entry, as does valid JSON of an unrecognized shape. ([validated by `agent-log-entries.test.ts:47`](apps/web-ui/src/lib/agent-log-entries.test.ts#L68), [validated by `agent-log-entries.test.ts:53`](apps/web-ui/src/lib/agent-log-entries.test.ts#L74), [validated by `agent-log-entries.test.ts:212`](apps/web-ui/src/lib/agent-log-entries.test.ts#L233))

Lifecycle markers become status entries, carrying the exit code when present. ([validated by `agent-log-entries.test.ts:59`](apps/web-ui/src/lib/agent-log-entries.test.ts#L80))

A lifecycle marker's `phase` is carried on the entry, so a phase like `init` reads as `· init started` instead of falling back to the unclassified default; a marker with no phase keeps the bare `· agent <status>` line. ([validated by `agent-log-entries.test.ts:332`](apps/web-ui/src/lib/agent-log-entries.test.ts#L353), [`agent-log-entries.test.ts:338`](apps/web-ui/src/lib/agent-log-entries.test.ts#L359), [`LogEntriesView.test.tsx:33`](apps/web-ui/src/components/LogEntriesView.test.tsx#L33))

The system init line becomes a session-init entry exposing the model, the Claude Code version, and the pretty-printed full payload. ([validated by `agent-log-entries.test.ts:68`](apps/web-ui/src/lib/agent-log-entries.test.ts#L89))

Consecutive thinking_tokens ticker lines coalesce into a single counter entry holding the run's latest count; a run broken by any other entry starts a new counter. ([validated by `agent-log-entries.test.ts:81`](apps/web-ui/src/lib/agent-log-entries.test.ts#L102), [validated by `agent-log-entries.test.ts:93`](apps/web-ui/src/lib/agent-log-entries.test.ts#L114))

A hook's `hook_*` system lines become one hook entry naming the hook, its phase, and — once it finishes — its outcome and exit code, so a hook reads as a sentence rather than a JSON blob. ([validated by [`agent-log-entries.test.ts:453`](apps/web-ui/src/lib/agent-log-entries.test.ts#L466), [`agent-log-entries.test.ts:465`](apps/web-ui/src/lib/agent-log-entries.test.ts#L478), [`agent-log-entries.test.ts:479`](apps/web-ui/src/lib/agent-log-entries.test.ts#L492))

`hook_progress` restates the whole output so far rather than an increment, so consecutive entries sharing a `hook_id` collapse to the newest one; the fold is adjacent-only and keyed on identity, so two hooks running concurrently keep their interleaved order instead of collapsing across each other. ([validated by [`agent-log-entries.test.ts:485`](apps/web-ui/src/lib/agent-log-entries.test.ts#L498), [`agent-log-entries.test.ts:506`](apps/web-ui/src/lib/agent-log-entries.test.ts#L519), [`agent-log-entries.test.ts:526`](apps/web-ui/src/lib/agent-log-entries.test.ts#L539))

A `system` line of any subtype the parser does not recognize is summarized as `· system: <subtype>` over its pretty-printed payload rather than dumped raw, while `init` and `thinking_tokens` keep their own richer entries. ([validated by [`agent-log-entries.test.ts:601`](apps/web-ui/src/lib/agent-log-entries.test.ts#L614), [`agent-log-entries.test.ts:615`](apps/web-ui/src/lib/agent-log-entries.test.ts#L628))

A hook renders as one dim line carrying its verdict — `✓ (exit 0)`, `✗ (exit 2)`, or `running…` while it is still going; a finished hook that reported no exit code is judged on its outcome alone, so `success` reads as `✓` rather than being marked failed by the absent code — with any output kept behind the summary and a non-zero exit styled as an error. ([validated by [`LogEntriesView.test.tsx:211`](apps/web-ui/src/components/LogEntriesView.test.tsx#L215), [`LogEntriesView.test.tsx:219`](apps/web-ui/src/components/LogEntriesView.test.tsx#L223), [`LogEntriesView.test.tsx:227`](apps/web-ui/src/components/LogEntriesView.test.tsx#L231), [`LogEntriesView.test.tsx:235`](apps/web-ui/src/components/LogEntriesView.test.tsx#L239), [`LogEntriesView.test.tsx:243`](apps/web-ui/src/components/LogEntriesView.test.tsx#L298), [`LogEntriesView.test.tsx:243`](apps/web-ui/src/components/LogEntriesView.test.tsx#L247))

Assistant and user messages emit one entry per content block — thinking, text, and tool_use — in order. ([validated by `agent-log-entries.test.ts:108`](apps/web-ui/src/lib/agent-log-entries.test.ts#L129), [validated by `agent-log-entries.test.ts:117`](apps/web-ui/src/lib/agent-log-entries.test.ts#L138), [validated by `agent-log-entries.test.ts:218`](apps/web-ui/src/lib/agent-log-entries.test.ts#L239))

A tool_use block is summarized as `→ <tool>: <most relevant arg>`, falling back to the bare tool name when no recognized text argument is present. ([validated by `agent-log-entries.test.ts:126`](apps/web-ui/src/lib/agent-log-entries.test.ts#L147), [validated by `agent-log-entries.test.ts:135`](apps/web-ui/src/lib/agent-log-entries.test.ts#L156))

A tool_result block yields its text — string or array form, tool references bracketed — with is_error preserved and real newlines kept. ([validated by `agent-log-entries.test.ts:141`](apps/web-ui/src/lib/agent-log-entries.test.ts#L162), [validated by `agent-log-entries.test.ts:147`](apps/web-ui/src/lib/agent-log-entries.test.ts#L168), [validated by `agent-log-entries.test.ts:156`](apps/web-ui/src/lib/agent-log-entries.test.ts#L177))

User text blocks (the injected task prompt) become user-text entries. ([validated by `agent-log-entries.test.ts:162`](apps/web-ui/src/lib/agent-log-entries.test.ts#L183))

The terminal result line yields a result entry with the agent text, error flag, duration, cost and turn count; a station's LORE_NODE_RESULT text is kept verbatim. ([validated by `agent-log-entries.test.ts:171`](apps/web-ui/src/lib/agent-log-entries.test.ts#L192), [validated by `agent-log-entries.test.ts:190`](apps/web-ui/src/lib/agent-log-entries.test.ts#L211))

Station eventLine progress lines become station-log entries. ([validated by `agent-log-entries.test.ts:184`](apps/web-ui/src/lib/agent-log-entries.test.ts#L205))

A `rate_limit_event` line becomes a rate-limit entry naming every window's whole-percent utilization, reset time and status, reading `unifiedWindows` when present and falling back to the single top-level window otherwise; a shape carrying no readable window is kept raw rather than rendering a confidently empty sentence. `utilization` is the fraction the event sends, never treated as an already-computed percent. ([validated by `agent-log-entries.test.ts:346`](apps/web-ui/src/lib/agent-log-entries.test.ts#L367), [`agent-log-entries.test.ts:359`](apps/web-ui/src/lib/agent-log-entries.test.ts#L380), [`agent-log-entries.test.ts:381`](apps/web-ui/src/lib/agent-log-entries.test.ts#L402), [`agent-log-entries.test.ts:387`](apps/web-ui/src/lib/agent-log-entries.test.ts#L408), [`agent-log-entries.test.ts:410`](apps/web-ui/src/lib/agent-log-entries.test.ts#L431), [`agent-log-entries.test.ts:418`](apps/web-ui/src/lib/agent-log-entries.test.ts#L439), [`agent-log-entries.test.ts:433`](apps/web-ui/src/lib/agent-log-entries.test.ts#L454), [`LogEntriesView.test.tsx:43`](apps/web-ui/src/components/LogEntriesView.test.tsx#L43))

Lines wrapped in the ai-agent-subsystem's attribution envelope — single or the transitional double wrap — classify identically to their bare payload. ([validated by `agent-log-entries.test.ts:200`](apps/web-ui/src/lib/agent-log-entries.test.ts#L221), [validated by `agent-log-entries.test.ts:206`](apps/web-ui/src/lib/agent-log-entries.test.ts#L227))

A declared-artifact delivery — the subsystem raising a recipe-declared `output.watch` file as a `kind:"file"` event once the agent exits (e.g. `pr.description`) — becomes a file entry carrying the event name, path and content; a declared artifact the agent never produced carries its `reason` instead of content, and a `kind:"file"` line with no event name stays raw, since nothing could route it. ([validated by `agent-log-entries.test.ts:754`](apps/web-ui/src/lib/agent-log-entries.test.ts#L754), [`agent-log-entries.test.ts:766`](apps/web-ui/src/lib/agent-log-entries.test.ts#L766), [`agent-log-entries.test.ts:778`](apps/web-ui/src/lib/agent-log-entries.test.ts#L778))

A file entry renders as a collapsed details summarized `⇢ <event> — <path>` over the delivered content, and a never-produced artifact as an error line naming the event and reason. ([validated by `LogEntriesView.test.tsx:338`](apps/web-ui/src/components/LogEntriesView.test.tsx#L338), [`LogEntriesView.test.tsx:351`](apps/web-ui/src/components/LogEntriesView.test.tsx#L351))

#### The gemini stream-json dialect (2026-09)

GeminiAgent pods (the ai-agent-subsystem's `gemini --output-format stream-json` vendor) emit a flat event dialect the claude branches never match — no `message.content` blocks, `parameters` where claude says `input` — so before this section every gemini line rendered as a raw JSON blob. The same classifier speaks both dialects; the fixtures are captured from the first production gemini review run (2026-09-02).

A gemini `init` event becomes a session-init entry exposing the model and the pretty-printed payload, with no Claude Code version claimed. ([validated by `agent-log-entries.test.ts:633`](apps/web-ui/src/lib/agent-log-entries.test.ts#L635))

A gemini `message` with string content classifies by role — user-text for the injected prompt, assistant-text otherwise. ([validated by `agent-log-entries.test.ts:643`](apps/web-ui/src/lib/agent-log-entries.test.ts#L645))

Assistant prose arrives ONLY as `delta: true` chunks — gemini-cli emits no final complete message — so adjacent chunks merge into one assistant-text entry, and the fold is adjacent-only: a tool call between chunks starts a new paragraph rather than gluing across it. `mergedDelta` is the one home for the rule, shared by the blob parser and the run page's timed conversation, which keeps the merged utterance on its FIRST chunk's timestamp. ([validated by `agent-log-entries.test.ts:682`](apps/web-ui/src/lib/agent-log-entries.test.ts#L684), [`agent-log-entries.test.ts:697`](apps/web-ui/src/lib/agent-log-entries.test.ts#L699), [`agent-log-entries.test.ts:733`](apps/web-ui/src/lib/agent-log-entries.test.ts#L735), [`turn-transcript-presenter.test.ts:363`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L363))

A top-level gemini `tool_use` summarizes as `→ <tool>: <most relevant arg>` from `tool_name` and `parameters`, through the same summary rule the claude blocks use. ([validated by `agent-log-entries.test.ts:652`](apps/web-ui/src/lib/agent-log-entries.test.ts#L654))

A top-level gemini `tool_result` yields its `output` — or its `error.message` when there is no output — with `status: "error"` mapped to the error flag; `status` is the CLI's verdict on the dispatch, so a failed command under `status: "success"` stays non-error, exactly as the stream reports it. ([validated by `agent-log-entries.test.ts:662`](apps/web-ui/src/lib/agent-log-entries.test.ts#L664), [`agent-log-entries.test.ts:672`](apps/web-ui/src/lib/agent-log-entries.test.ts#L674))

Gemini's standalone `error` event — a shape claude does not have; claude carries errors inside its result line — becomes an agent-error entry styled by severity: an `error` renders with the error style, a `warning` dimmed. ([validated by `agent-log-entries.test.ts:711`](apps/web-ui/src/lib/agent-log-entries.test.ts#L713), [`LogEntriesView.test.tsx:304`](apps/web-ui/src/components/LogEntriesView.test.tsx#L306), [`LogEntriesView.test.tsx:316`](apps/web-ui/src/components/LogEntriesView.test.tsx#L318))

A gemini `result` keyed by `status` folds into the existing result entry: `status: "error"` sets the error flag and the entry text falls back to `error.message`, since gemini's terminal line carries no `result` string. ([validated by `agent-log-entries.test.ts:721`](apps/web-ui/src/lib/agent-log-entries.test.ts#L723), [`agent-log-entries.test.ts:727`](apps/web-ui/src/lib/agent-log-entries.test.ts#L729))

The captured production sample parses into the expected ordered kind sequence with one counter per ticker run. ([validated by `agent-log-entries.test.ts:239`](apps/web-ui/src/lib/agent-log-entries.test.ts#L260))

formatTokens abbreviates counts of a thousand or more with a `k` suffix, formatDuration renders the two largest time units, and clip flattens whitespace and truncates with an ellipsis. ([validated by `agent-log-entries.test.ts:263`](apps/web-ui/src/lib/agent-log-entries.test.ts#L284), [validated by `agent-log-entries.test.ts:271`](apps/web-ui/src/lib/agent-log-entries.test.ts#L292), [validated by `agent-log-entries.test.ts:279`](apps/web-ui/src/lib/agent-log-entries.test.ts#L300))

#### Rendering (`LogEntriesView`)

Lifecycle and station-log entries render as dimmed `·` lines, with the exit code appended when present. ([validated by `LogEntriesView.test.tsx:17`](apps/web-ui/src/components/LogEntriesView.test.tsx#L25), [validated by `LogEntriesView.test.tsx:58`](apps/web-ui/src/components/LogEntriesView.test.tsx#L66), [validated by `LogEntriesView.test.tsx:146`](apps/web-ui/src/components/LogEntriesView.test.tsx#L154))

The session-init entry renders as a collapsed details block whose summary names the model and Claude Code version. ([validated by `LogEntriesView.test.tsx:68`](apps/web-ui/src/components/LogEntriesView.test.tsx#L76))

The thinking-tokens counter renders italic-dimmed as `thinking… ~N tokens`, and tool summaries render with the accent class. ([validated by `LogEntriesView.test.tsx:82`](apps/web-ui/src/components/LogEntriesView.test.tsx#L90), [validated by `LogEntriesView.test.tsx:92`](apps/web-ui/src/components/LogEntriesView.test.tsx#L100))

A short single-line tool result renders inline; a long or multiline one collapses into an expandable details block carrying the error class when is_error. ([validated by `LogEntriesView.test.tsx:100`](apps/web-ui/src/components/LogEntriesView.test.tsx#L108), [validated by `LogEntriesView.test.tsx:117`](apps/web-ui/src/components/LogEntriesView.test.tsx#L125))

The terminal result renders a summary footer with duration, cost and turn count — or `✗ failed` carrying the error class — with the result text expandable. ([validated by `LogEntriesView.test.tsx:127`](apps/web-ui/src/components/LogEntriesView.test.tsx#L135), [validated by `LogEntriesView.test.tsx:136`](apps/web-ui/src/components/LogEntriesView.test.tsx#L144))

The user prompt renders as collapsed details prefixed `user:`. ([validated by `LogEntriesView.test.tsx:158`](apps/web-ui/src/components/LogEntriesView.test.tsx#L166))

Raw entries render verbatim; assistant text and thinking render with their own classes. ([validated by `LogEntriesView.test.tsx:175`](apps/web-ui/src/components/LogEntriesView.test.tsx#L183), [validated by `LogEntriesView.test.tsx:187`](apps/web-ui/src/components/LogEntriesView.test.tsx#L195))

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
