# Feature Specification: Job Log Streaming in Pipeline UI

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Job Log Streaming                        |
| Branch         | feat/job-log-streaming                   |
| Status         | In Progress                              |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 3-5 days                                 |

Job Log Streaming shows what an agent's pod printed, on the run page, without cluster access. lore-api answers one node's log for a run of either engine, and the web UI parses the log lines into typed entries and renders them as a readable transcript.

## Problem Statement

A person watching a run needs to see what the agent in the pod is doing. Without a log surface in the UI they see "running" and wait, and the only way to look further is `kubectl logs` on a cluster most readers cannot reach. A pod's raw output is also hard to read: it is one JSON document per line, in two vendor dialects.

## Background

This spec was written on 2026-04-01 for a different design. Lore's own controller read a task pod's logs, a watcher copied them into `pipeline.task_events`, and a viewer on the task page polled a logs route. Later amendments made the failed init container's log readable and attached the pod's failure cause to the Agent custom resource. None of that runs any more. The task-page viewer was removed on 2026-08-28 (#1611), Lore's own Floor with its controller, watcher and pod-log reader on 2026-10-02 (#2431), and the task page itself, with its FailurePanel, on 2026-10-05 (#2500). A task id now redirects to its newest run.

Agents run in pods of the external floor (ADR-049). Lore holds no Kubernetes client and reads no pod. What survives from the original design is the parsing and rendering layer, which the task page always shared with the run page, and a node-logs route that lore-api now answers itself.

Two kinds of run exist. A run Lore's own Floor walked before 2026-10-02 is history in Postgres: its pods' stdout sits in `pipeline.pod_log_chunks`. Nothing writes that table any more, and the `telemetry-prune` sweep deletes its rows past the retention window. A run on the external floor keeps its records in the floor: the agent's stream-json lines are `turn` records, which the transcript draws, and the floor runtime's own notes about the visit are `log` records, which the pod-log panel draws.

How a failed visit says why is no longer part of this spec. The run page shows the failure in the run header and on the failed node (`specs/assembly-line-run-viz`).

## Solution

A node's log is read on demand through lore-api and rendered by the run page.

### Architecture

```
Run page, attempt inspector (AgentAttemptCard)
  ↓ Show: pod logs
NodeLogPanel fetches /api/assembly-runs/{id}/nodes/{name}/logs (web-ui proxy)
  ↓
lore-api GET /api/assembly-runs/{id}/nodes/{name}/logs
  ↓ Postgres first                      ↓ otherwise
stored stdout (pipeline.pod_log_chunks)  the floor's log records of visit floor-<visit id>
  ↓
parseAgentLog → LogEntriesView (Formatted), or the log text as answered (Raw)
```

### Where a node's log comes from

1. lore-api serves `GET /api/assembly-runs/{id}/nodes/{name}/logs`, passes a positive integer `tail` query to the reader, and answers `404` for a name that is no node of the run. ([validated by answers the log of floor-visit-1 of run-1, tail 20 @0c7bd661](apps/lore-api/src/transport/routes/floor/node-logs.test.ts#L27), [validated by answers 404 for a name of no visit of this run @c17afccb](apps/lore-api/src/transport/routes/floor/node-logs.test.ts#L45))

2. `nodeLogsReader` asks Postgres first and the floor only for a name Postgres has no node for, or on a deployment with no database. ([validated by answers the stored stdout of a node of a Postgres run without asking the floor @45ae649e](apps/lore-api/src/transport/routes/floor/node-logs.test.ts#L63), [validated by asks the floor for a name Postgres has no node for @7ee9e5b2](apps/lore-api/src/transport/routes/floor/node-logs.test.ts#L80), [validated by asks the floor on a deployment with no database @50fa9f51](apps/lore-api/src/transport/routes/floor/node-logs.test.ts#L89))

3. For a node of a run Postgres has, `storedRunHistory.nodeLogs` joins the node's chunks from `pipeline.pod_log_chunks` into one log, marks it `archived`, and reports the node's outcome as `phase`. ([validated by answers the stored stdout of abc-review as archived, with the node's outcome as its phase @74532d89](apps/lore-api/src/work/floor/stored-run-history.test.ts#L72), [validated by reassembles a CR's chunks by agent name, the key a reader still holds when the CR is in another cluster @45a246f9](libs/shared/src/outbound/project/pod-logs/pod-logs.test.ts#L134))

4. A `tail` keeps the last N lines of the stored log. ([validated by keeps the last 1 line when tail is 1 @71f2bc99](apps/lore-api/src/work/floor/stored-run-history.test.ts#L84), [validated by returns only the last N lines when a tail is asked for @8174202d](libs/shared/src/outbound/project/pod-logs/pod-logs.test.ts#L108))

5. A node whose stdout was pruned or never stored answers `available: false` with `reason: "no-records"`. ([validated by says no-records for a node whose stdout was pruned or never stored @1b957cab](apps/lore-api/src/work/floor/stored-run-history.test.ts#L90))

6. The stored read answers nothing for a node of another run or for a name Postgres has no node for, so one run's name cannot read another run's log. ([validated by answers null for a node of another run, so the name of one run cannot read another's log @78000d37](apps/lore-api/src/work/floor/stored-run-history.test.ts#L103), [validated by answers null for a name Postgres has no node for, which is a floor visit @896549b2](apps/lore-api/src/work/floor/stored-run-history.test.ts#L113))

7. For a name `floor-<visit id>`, `runNodeLogs` reads the visit's `log` records from the floor through `@re-cinq/floor-client`. ([validated by reads floor-visit-1's log as one available line of run-1 @2210da94](apps/lore-api/src/work/floor/floor-run-reader.test.ts#L157), [validated by reads visit-1 out of floor-visit-1 @fd7f1d33](apps/lore-api/src/work/floor/floor-records.test.ts#L39))

8. The floor read answers nothing for a visit of another run, and for a name without the `floor-` prefix it answers nothing without asking the floor. ([validated by answers null for floor-visit-1 asked of run-2, which it is no visit of @a7df9373](apps/lore-api/src/work/floor/floor-run-reader.test.ts#L166), [validated by answers null for a Lore pod's name cr-implement without asking the floor @db695356](apps/lore-api/src/work/floor/floor-run-reader.test.ts#L172), [validated by reads null out of a Lore pod's name cr-implement @5bbb842f](apps/lore-api/src/work/floor/floor-records.test.ts#L43))

9. `nodeLogsOf` writes each log record as one line, its time followed by its body, and reports `Succeeded` once the visit reported success. ([validated by joins the log records into lines stamped with their time, Succeeded once the visit reported success @e067c996](apps/lore-api/src/work/floor/floor-records.test.ts#L51))

10. `nodeLogsOf` keeps the last `tail` lines and reports `Running` while the visit has no report. ([validated by keeps the last 1 line for tail 1, and reads Running while the visit is open @e2f05085](apps/lore-api/src/work/floor/floor-records.test.ts#L61))

11. An open visit with no log record yet answers an available, empty log, so the panel keeps polling. ([validated by answers an empty but available log, Running, for an open visit with no record yet, so the panel keeps polling @fd03b1c9](apps/lore-api/src/work/floor/floor-records.test.ts#L70))

12. A visit that ended with no log record answers `available: false` with `reason: "no-records"` and its `Failed` or `Succeeded` phase. ([validated by says the floor kept no records, Failed, for a failed visit with no log @f708a85c](apps/lore-api/src/work/floor/floor-records.test.ts#L78))

### The web-ui proxy

13. The browser reads a node's log from the web UI's own route, whose path `nodeLogsUrl` builds from the encoded run id and node name. ([validated by builds the proxy path and encodes the run id and the agent CR name @9429be47](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L20))

14. The proxy refuses a viewer who cannot access the run's repository with `403` and makes no upstream call. ([validated by returns 403 when the user cannot access the run repo @a74830e5](apps/web-ui/src/app/api/assembly-runs/[id]/nodes/[name]/logs/route.test.ts#L75))

15. The proxy requests the log on lore-api under the run and the node's name, with the `tail` it was given, at the URL `nodeLogsUpstream` builds. ([validated by requests the node's log on lore-api under the run and the node's name, with the tail @bf11ad9b](apps/web-ui/src/app/api/assembly-runs/[id]/nodes/[name]/logs/route.test.ts#L86), [validated by reads a node's logs from lore-api under the run and the encoded name @413a640b](apps/web-ui/src/lib/run-read-upstream.test.ts#L29))

16. The proxy returns lore-api's status and body unchanged, on success and on a non-auth error. ([validated by returns the upstream status and body verbatim on success @03f7305b](apps/web-ui/src/app/api/assembly-runs/[id]/nodes/[name]/logs/route.test.ts#L96), [validated by passes a non-auth upstream error like 500 through unchanged @f2e5a692](apps/web-ui/src/app/api/assembly-runs/[id]/nodes/[name]/logs/route.test.ts#L66))

17. An upstream `401` or `403` is returned as `502`, so the panel does not tell an authorized viewer that access is denied. ([validated by surfaces an upstream 401 as 502 so it cannot masquerade as the proxy's own auth ladder @b8e00245](apps/web-ui/src/app/api/assembly-runs/[id]/nodes/[name]/logs/route.test.ts#L45), [validated by surfaces an upstream 403 as 502 so NodeLogPanel does not render access denied for an authorized viewer @3e0c912a](apps/web-ui/src/app/api/assembly-runs/[id]/nodes/[name]/logs/route.test.ts#L57))

18. The proxy answers `404` for a name that is not the `agentCrName` of one of the run's nodes.

## Out of Scope

1. Streaming the pod-log panel over a socket. The panel polls. The transcript follows the live socket (`specs/assembly-line-run-viz` FR7).
2. Searching or filtering a log.
3. Storing logs. The floor keeps its own records, and the stdout Postgres stored is history that the `telemetry-prune` sweep removes.

## Acceptance Criteria

1. A pod-log panel that is open on mount fetches its log at once and renders it as formatted entries. ([validated by fetches on mount when opened by default @0af9c666](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L56), [validated by `NodeLogPanel.test.tsx@f00305c8`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L86))

2. A collapsed pod-log panel shows its label and fetches nothing until it is opened. ([validated by renders the collapsed label without fetching until opened @0ecb8fa2](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L75))

3. The panel fetches again on a timer only while the last answer is available and its phase is `Running`. ([validated by returns false before any response @0a45bcf7](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L28), [validated by returns true while a live pod is running @92db978d](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L32), [validated by returns false once the pod reaches a terminal phase @df9e4c65](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L36), [validated by returns false when logs are unavailable @468ac80b](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L40))

4. `AgentAttemptCard` shows an agent attempt's transcript or its pod logs, whichever the inspector's Show select asks for, and labels the log panel `Pod logs · attempt N`.

5. An attempt with no `agentCrName` never reached a pod, so the card shows a sentence saying it has no logs instead of a panel.

6. The panel polls every 5 seconds and scrolls to the newest line on every answer.

7. A `403` from the proxy is shown as an access-denied message, and any other failed fetch as `Failed to load logs: <error>`.

## Component Contract

### Readable transcript rendering (2026-07)

The pod-log panel parses its log line by line and renders typed entries in place of the raw JSON. ([validated by `NodeLogPanel.test.tsx@f00305c8`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L86))

The panel is formatted by default, and its Raw/Formatted toggle switches to the log text exactly as lore-api answered it. ([validated by `NodeLogPanel.test.tsx@7f5ef348`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L100))

An available but empty log shows the `(no output yet)` placeholder and no toggle. ([validated by `NodeLogPanel.test.tsx@a9a97ea5`](apps/web-ui/src/app/assembly-runs/[id]/NodeLogPanel.test.tsx#L114))

A floor node whose visit kept no log shows "The floor kept no log for this node; its transcript is above." ([validated by says the floor kept no log for a floor run's node whose visit has no records @7d3a9d1d](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L60))

A node of any other run whose log is unavailable for a reason the panel does not know shows "Logs are not available for this node." ([validated by falls back for an unknown reason @024219ea](apps/web-ui/src/app/assembly-runs/[id]/node-pod-logs-presenter.test.ts#L70))

The transcript panel uses the same parser and the same line renderer on stored turns. It is specified in `specs/turn-level-transcript-store` FR5 and has no Raw toggle.

#### Parsing (`agent-log-entries.ts`)

Each NDJSON line of an agent pod's stream parses into typed entries. Blank and whitespace-only lines are skipped, and an empty blob yields no entries. ([validated by `agent-log-entries.test.ts@18ed2996`](apps/web-ui/src/lib/agent-log-entries.test.ts#L63), [validated by `agent-log-entries.test.ts@7a3e886e`](apps/web-ui/src/lib/agent-log-entries.test.ts#L364))

`parseAgentLog` is built on two smaller exports: `parseAgentLogLine` classifies one line, and `logEntriesFromValue` classifies an already-decoded envelope, which the transcript uses because the transcript store hands out parsed JSON. ([validated by `agent-log-entries.test.ts@5ef5e9d0`](apps/web-ui/src/lib/agent-log-entries.test.ts#L368), [validated by `agent-log-entries.test.ts@bf765371`](apps/web-ui/src/lib/agent-log-entries.test.ts#L374), [validated by classifies a decoded envelope the same as its serialized line @d4f77057](apps/web-ui/src/lib/agent-log-entries.test.ts#L382), [validated by `agent-log-entries.test.ts@813ce08a`](apps/web-ui/src/lib/agent-log-entries.test.ts#L390))

A line that is not JSON becomes a raw entry carrying the line's text. This covers a runner marker and an unterminated fragment from an in-flight poll. ([validated by `agent-log-entries.test.ts@bc978f2d`](apps/web-ui/src/lib/agent-log-entries.test.ts#L68), [validated by `agent-log-entries.test.ts@5a97b596`](apps/web-ui/src/lib/agent-log-entries.test.ts#L74), [validated by `agent-log-entries.test.ts@bf765371`](apps/web-ui/src/lib/agent-log-entries.test.ts#L374))

Valid JSON of a shape the parser does not recognize becomes a raw entry carrying the original line. ([validated by `agent-log-entries.test.ts@0ece676d`](apps/web-ui/src/lib/agent-log-entries.test.ts#L243), [validated by `agent-log-entries.test.ts@813ce08a`](apps/web-ui/src/lib/agent-log-entries.test.ts#L390))

`parseAgentLogLine` trims surrounding whitespace from a line before it classifies it, so a raw entry carries the trimmed text. The panel's Raw view is where the untrimmed log is read.

Lifecycle markers become lifecycle entries, carrying the exit code when present. ([validated by `agent-log-entries.test.ts@a24fb2a2`](apps/web-ui/src/lib/agent-log-entries.test.ts#L80))

A lifecycle marker's `phase` is carried on the entry, so a marker of the `init` phase reads `· init started`. A marker with no phase keeps the `· agent <status>` line. ([validated by carries the init phase so the marker is not an unclassified line @41d36705](apps/web-ui/src/lib/agent-log-entries.test.ts#L410), [validated by `agent-log-entries.test.ts@e77f1b27`](apps/web-ui/src/lib/agent-log-entries.test.ts#L416), [validated by `LogEntriesView.test.tsx@4e86037e`](apps/web-ui/src/components/LogEntriesView.test.tsx#L33))

The Claude Code `init` line becomes a session-init entry exposing the model, the Claude Code version, and the pretty-printed payload. An init line carrying neither reads `unknown model` with no version. ([validated by `agent-log-entries.test.ts@782e477f`](apps/web-ui/src/lib/agent-log-entries.test.ts#L89), [validated by `agent-log-entries.test.ts@4f029181`](apps/web-ui/src/lib/agent-log-entries.test.ts#L102))

Consecutive `thinking_tokens` lines coalesce into one counter entry holding the latest count. A run broken by any other entry starts a new counter. ([validated by coalesces a run of three thinking_tokens lines into one entry with the latest count 444 @78ffc6d4](apps/web-ui/src/lib/agent-log-entries.test.ts#L112), [validated by starts a new thinking-tokens counter after the run is broken by another entry @7677a5e8](apps/web-ui/src/lib/agent-log-entries.test.ts#L124), [validated by `agent-log-entries.test.ts@4920f4de`](apps/web-ui/src/lib/agent-log-entries.test.ts#L398))

A hook's `hook_*` system lines become hook entries naming the hook, its phase, and, once it finishes, its outcome and exit code. ([validated by `agent-log-entries.test.ts@44bbb992`](apps/web-ui/src/lib/agent-log-entries.test.ts#L523), [validated by `agent-log-entries.test.ts@81e18129`](apps/web-ui/src/lib/agent-log-entries.test.ts#L535), [validated by keeps exit code 2 and a blocked outcome on a failed hook @231af64f](apps/web-ui/src/lib/agent-log-entries.test.ts#L549))

`hook_progress` restates the whole output so far, so consecutive entries sharing a `hook_id` collapse to the newest one. The fold is adjacent-only and keyed on the id, so two hooks running at once keep their interleaved order. ([validated by folds a cumulative progress run into the last entry for that hook @a920f80b](apps/web-ui/src/lib/agent-log-entries.test.ts#L555), [validated by keeps two interleaved hooks apart, folding each on its own hook_id @f2f6a9a6](apps/web-ui/src/lib/agent-log-entries.test.ts#L576), [validated by does not fold a hook entry onto a different hook_id @ab4ee5d3](apps/web-ui/src/lib/agent-log-entries.test.ts#L596))

A `tool_progress` line becomes a tool-progress entry naming the tool and its elapsed time, and a run of heartbeats for one tool call folds into its latest one. A line that reports no elapsed time carries none, and a heartbeat does not fold onto a different call. ([validated by names the tool and its elapsed time off a tool_progress line @db62245c](apps/web-ui/src/lib/agent-log-entries.test.ts#L613), [validated by folds a run of heartbeats for one call into its latest elapsed time @7f6f31a6](apps/web-ui/src/lib/agent-log-entries.test.ts#L624), [validated by carries no elapsed time for a progress line that reports none @6c6e9147](apps/web-ui/src/lib/agent-log-entries.test.ts#L639), [validated by does not fold a heartbeat onto a different tool call @1a1d45a3](apps/web-ui/src/lib/agent-log-entries.test.ts#L655))

A `system` line of a subtype the parser does not recognize becomes a system entry naming the subtype over its pretty-printed payload. `init` and `thinking_tokens` keep their own entries. ([validated by summarizes a compact_boundary line instead of dumping raw JSON @102088c5](apps/web-ui/src/lib/agent-log-entries.test.ts#L671), [validated by `agent-log-entries.test.ts@b30eb5a1`](apps/web-ui/src/lib/agent-log-entries.test.ts#L685))

Assistant and user messages emit one entry per content block (thinking, text, tool_use, tool_result), in order. ([validated by `agent-log-entries.test.ts@e00fe1bd`](apps/web-ui/src/lib/agent-log-entries.test.ts#L139), [validated by `agent-log-entries.test.ts@41808cf8`](apps/web-ui/src/lib/agent-log-entries.test.ts#L148), [validated by emits one entry per content block when a message carries thinking and tool_use together @d217300a](apps/web-ui/src/lib/agent-log-entries.test.ts#L249))

A tool_use block is summarized as `→ <tool>: <most relevant arg>`, or as the bare tool name when it has no recognized text argument. ([validated by summarizes a Bash tool_use to '→ Bash: gh pr view 871 …' @0946a4d6](apps/web-ui/src/lib/agent-log-entries.test.ts#L157), [validated by summarizes a tool_use without a recognized text arg as the bare tool name @d025bbb5](apps/web-ui/src/lib/agent-log-entries.test.ts#L166))

A tool_result block yields its text, in string or array form with tool references bracketed, with `is_error` preserved and real newlines kept. ([validated by `agent-log-entries.test.ts@742451f8`](apps/web-ui/src/lib/agent-log-entries.test.ts#L172), [validated by marks the exit-127 tool_result as error and keeps its newline @2fd7e4f8](apps/web-ui/src/lib/agent-log-entries.test.ts#L178), [validated by `agent-log-entries.test.ts@a24722c9`](apps/web-ui/src/lib/agent-log-entries.test.ts#L187))

User text blocks, which carry the injected task prompt, become user-text entries. ([validated by `agent-log-entries.test.ts@a37d26a9`](apps/web-ui/src/lib/agent-log-entries.test.ts#L193))

The terminal result line yields a result entry with the agent's text, error flag, duration, cost and turn count. A station's `LORE_NODE_RESULT` text is kept verbatim inside it. ([validated by parses the terminal result line to duration 201372ms, 27 turns and cost @3e20c10b](apps/web-ui/src/lib/agent-log-entries.test.ts#L202), [validated by `agent-log-entries.test.ts@d4bec5bd`](apps/web-ui/src/lib/agent-log-entries.test.ts#L221))

Station `eventLine` progress lines become station-log entries. ([validated by `agent-log-entries.test.ts@9ad26845`](apps/web-ui/src/lib/agent-log-entries.test.ts#L215))

A `rate_limit_event` line becomes a rate-limit entry naming every window's utilization and reset time. It reads `unifiedWindows` when present and the single top-level window otherwise, and drops a window with no numeric utilization. ([validated by `agent-log-entries.test.ts@62601ecc`](apps/web-ui/src/lib/agent-log-entries.test.ts#L424), [validated by falls back to the single top-level window when there are no unified ones @abf814a9](apps/web-ui/src/lib/agent-log-entries.test.ts#L437), [validated by `agent-log-entries.test.ts@32158f6d`](apps/web-ui/src/lib/agent-log-entries.test.ts#L465))

A rate-limit line with no readable window is kept raw. ([validated by keeps a rate-limit line raw when it carries no readable window @3c5bb682](apps/web-ui/src/lib/agent-log-entries.test.ts#L459), [validated by `agent-log-entries.test.ts@35b702c5`](apps/web-ui/src/lib/agent-log-entries.test.ts#L488))

`rateLimitSummary` names every window with its whole-percent utilization and the status, and omits the status when the event carries none. `utilization` is a fraction and is multiplied by 100. ([validated by `agent-log-entries.test.ts@500d4ca2`](apps/web-ui/src/lib/agent-log-entries.test.ts#L496), [validated by `agent-log-entries.test.ts@0233e9a3`](apps/web-ui/src/lib/agent-log-entries.test.ts#L511))

Lines wrapped in the ai-agent-subsystem's attribution envelope, single or double, classify the same as their bare payload. ([validated by classifies a single-wrapped envelope line the same as the bare line @bc2b425f](apps/web-ui/src/lib/agent-log-entries.test.ts#L231), [validated by classifies a double-wrapped envelope line the same as the bare line @b2b54c30](apps/web-ui/src/lib/agent-log-entries.test.ts#L237), [validated by `agent-log-entries.test.ts@5ef5e9d0`](apps/web-ui/src/lib/agent-log-entries.test.ts#L368))

A declared-artifact delivery (a `kind:"file"` event, for example `pr.description`) becomes a file entry carrying the event name, path and content. An artifact the agent never produced carries its `reason` and empty content, and a file event with neither path nor content defaults both to empty strings. ([validated by `agent-log-entries.test.ts@05e6af13`](apps/web-ui/src/lib/agent-log-entries.test.ts#L835), [validated by `agent-log-entries.test.ts@8158b45a`](apps/web-ui/src/lib/agent-log-entries.test.ts#L847), [validated by `agent-log-entries.test.ts@852c70b8`](apps/web-ui/src/lib/agent-log-entries.test.ts#L859))

A `kind:"file"` line with no event name stays raw. ([validated by `agent-log-entries.test.ts@18c70660`](apps/web-ui/src/lib/agent-log-entries.test.ts#L867))

A turn whose content blocks are all of known kinds but carry nothing to draw, such as a thinking block redacted to an empty string, yields no entry. ([validated by [`agent-log-entries.test.ts@40fd7a81`](apps/web-ui/src/lib/agent-log-entries.test.ts#L270), [validated by `agent-log-entries.test.ts@c15cdef2`](apps/web-ui/src/lib/agent-log-entries.test.ts#L284))

A turn with a content block of an unknown type is kept as a raw entry, including a type that names an `Object.prototype` member. ([validated by `agent-log-entries.test.ts@c15a354c`](apps/web-ui/src/lib/agent-log-entries.test.ts#L295), [validated by `agent-log-entries.test.ts@9f3383fd`](apps/web-ui/src/lib/agent-log-entries.test.ts#L306))

The captured production sample (`agent-log-entries.fixtures.ts`) parses into the expected ordered kind sequence with one counter per ticker run. ([validated by parses the assembled sample log into the expected kind sequence with one counter per run @b39dfdad](apps/web-ui/src/lib/agent-log-entries.test.ts#L317))

`formatTokens` abbreviates counts of a thousand or more with a `k` suffix. ([validated by formats 4200 tokens as ~4.2k and 444 as ~444 @95e06f93](apps/web-ui/src/lib/agent-log-entries.test.ts#L341))

`formatDuration` renders the two largest time units. ([validated by `agent-log-entries.test.ts@5054ddc1`](apps/web-ui/src/lib/agent-log-entries.test.ts#L349))

`clip` flattens whitespace and truncates with an ellipsis. ([validated by `agent-log-entries.test.ts@5e83f33d`](apps/web-ui/src/lib/agent-log-entries.test.ts#L357))

#### The gemini stream-json dialect (2026-09)

Gemini pods emit a flat event dialect: no `message.content` blocks, and `parameters` where Claude Code says `input`. The same classifier reads both dialects.

A gemini `init` event becomes a session-init entry exposing the model and the pretty-printed payload, with no Claude Code version. ([validated by parses the gemini init line to model gemini-3.1-pro-preview with pretty details @654998b6](apps/web-ui/src/lib/agent-log-entries.test.ts#L692))

A gemini `message` with string content from the user becomes a user-text entry. ([validated by parses a gemini user message with string content as user-text @efc6096e](apps/web-ui/src/lib/agent-log-entries.test.ts#L702))

Gemini assistant prose arrives only as `delta: true` chunks, so adjacent chunks merge into one assistant-text entry. ([validated by `agent-log-entries.test.ts@a80ce678`](apps/web-ui/src/lib/agent-log-entries.test.ts#L749))

The merge is adjacent-only: a tool call between two chunks starts a new entry. ([validated by does not merge delta chunks across an intervening tool_use @6231fe09](apps/web-ui/src/lib/agent-log-entries.test.ts#L764))

`mergedDelta` is the one home of the rule. It returns null for an entry that is not a delta, and the transcript's `conversationEntries` uses it too, keeping the merged entry on its first chunk's timestamp. ([validated by `agent-log-entries.test.ts@76bcf2ab`](apps/web-ui/src/lib/agent-log-entries.test.ts#L816), [validated by `turn-transcript-presenter.test.ts@d3b98a43`](apps/web-ui/src/app/assembly-runs/[id]/turn-transcript-presenter.test.ts#L351))

A top-level gemini `tool_use` is summarized from `tool_name` and `parameters` by the rule the Claude blocks use, and as the bare tool name when it has no parameters. ([validated by summarizes a top-level gemini tool_use from tool_name and parameters.command @598e9472](apps/web-ui/src/lib/agent-log-entries.test.ts#L711), [validated by `agent-log-entries.test.ts@b78fece9`](apps/web-ui/src/lib/agent-log-entries.test.ts#L721))

A top-level gemini `tool_result` yields its `output`, or its `error.message` when there is no output, with `status: "error"` mapped to the error flag. ([validated by parses a gemini tool_result with status success as a non-error tool-result @0b6ce17e](apps/web-ui/src/lib/agent-log-entries.test.ts#L729), [validated by parses a gemini tool_result with status error to the error message and isError true @7bcc6697](apps/web-ui/src/lib/agent-log-entries.test.ts#L739))

Gemini's standalone `error` event becomes an agent-error entry with severity `error` or `warning`. ([validated by parses a gemini error event to agent-error with severity error @10ac64d2](apps/web-ui/src/lib/agent-log-entries.test.ts#L778), [validated by parses a gemini error event with severity warning @95e5aa20](apps/web-ui/src/lib/agent-log-entries.test.ts#L788))

A gemini `result` keyed by `status` becomes a result entry: `status: "error"` sets the error flag, and the text falls back to `error.message`. ([validated by `agent-log-entries.test.ts@eef9a108`](apps/web-ui/src/lib/agent-log-entries.test.ts#L804), [validated by `agent-log-entries.test.ts@1531c019`](apps/web-ui/src/lib/agent-log-entries.test.ts#L810))

#### Rendering (`LogEntriesView`)

Lifecycle and station-log entries render as dimmed `·` lines, with the exit code appended when present. ([validated by `LogEntriesView.test.tsx@0ee1be0c`](apps/web-ui/src/components/LogEntriesView.test.tsx#L25), [validated by `LogEntriesView.test.tsx@872dadb0`](apps/web-ui/src/components/LogEntriesView.test.tsx#L66), [validated by renders a station-log entry as a dimmed line @9f6f6bc8](apps/web-ui/src/components/LogEntriesView.test.tsx#L172))

The session-init entry renders as a collapsed details block whose summary names the model and the Claude Code version, without the version parenthetical when the entry carries none. ([validated by `LogEntriesView.test.tsx@77c4cc55`](apps/web-ui/src/components/LogEntriesView.test.tsx#L76), [validated by `LogEntriesView.test.tsx@f8023b81`](apps/web-ui/src/components/LogEntriesView.test.tsx#L90))

The thinking-tokens counter renders italic and dimmed as `thinking… ~N tokens`. ([validated by renders 'thinking… ~444 tokens' italic-dimmed for a thinking-tokens entry @eab2134e](apps/web-ui/src/components/LogEntriesView.test.tsx#L108))

A tool summary renders with the tool accent class. ([validated by renders the tool summary '→ Bash: …' with the tool accent class @e7762914](apps/web-ui/src/components/LogEntriesView.test.tsx#L118))

A short single-line tool result renders inline. ([validated by renders a short tool-result inline without a details element @0b04fb84](apps/web-ui/src/components/LogEntriesView.test.tsx#L126))

A long or multiline tool result collapses into a details block, with the error class when `is_error`. ([validated by renders the multiline exit-127 tool-result as expandable details with the error class @62a91c2a](apps/web-ui/src/components/LogEntriesView.test.tsx#L143))

The terminal result renders a summary footer with duration, cost and turn count, or `✗ failed` with the error class. ([validated by LogEntriesView.test.tsx:153 @71c842f3](apps/web-ui/src/components/LogEntriesView.test.tsx#L153), [validated by renders '✗ failed' with the error class for an is_error result @eb790f47](apps/web-ui/src/components/LogEntriesView.test.tsx#L162))

The result text sits in a fold under the footer and renders as markdown, with its `LORE_NODE_RESULT` line as a node-result card. ([validated by renders the folded result text as markdown with its node-result card inside the fold @8055776d](apps/web-ui/src/components/LogEntriesView.test.tsx#L401))

The user prompt renders as collapsed details prefixed `user:`. ([validated by renders the user prompt as collapsed details prefixed 'user:' @ac48b4a8](apps/web-ui/src/components/LogEntriesView.test.tsx#L184))

A raw entry renders its text as it is. ([validated by renders a raw entry verbatim @2b189c09](apps/web-ui/src/components/LogEntriesView.test.tsx#L201))

Assistant text renders as markdown (see `specs/assembly-line-run-viz` FR4.19), and thinking with its own class. ([validated by renders assistant text as a markdown paragraph and thinking with its own class @17747078](apps/web-ui/src/components/LogEntriesView.test.tsx#L213), [validated by renders assistant text as markdown and its LORE_NODE_RESULT line as a node-result card @3b2f5cdb](apps/web-ui/src/components/LogEntriesView.test.tsx#L381))

A rate-limit entry renders as one line naming each window. ([validated by `LogEntriesView.test.tsx@ca6847cb`](apps/web-ui/src/components/LogEntriesView.test.tsx#L43))

A hook renders as one dim line with its verdict: `✓ (exit 0)`, `✗ (exit 2)` styled as an error, or `running…` with no expander while it is still going. ([validated by renders a finished hook as one line naming the hook and its exit code @aa7b8b2e](apps/web-ui/src/components/LogEntriesView.test.tsx#L233), [validated by marks a hook that exited non-zero as failed @7cbc30b0](apps/web-ui/src/components/LogEntriesView.test.tsx#L241), [validated by `LogEntriesView.test.tsx@7ed0ccec`](apps/web-ui/src/components/LogEntriesView.test.tsx#L249))

A hook's output is kept behind the summary. ([validated by `LogEntriesView.test.tsx@b9a76d78`](apps/web-ui/src/components/LogEntriesView.test.tsx#L257))

A finished hook that reported no exit code is judged on its outcome alone, so `success` reads as `✓`. ([validated by reads a successful hook that reported no exit code as finished, not failed @143f41b2](apps/web-ui/src/components/LogEntriesView.test.tsx#L265))

A folded heartbeat run renders as one line naming the tool and its elapsed time, without the clock when the heartbeat reports none. ([validated by renders a folded heartbeat run as one line naming the tool and its elapsed time @7c49bfc0](apps/web-ui/src/components/LogEntriesView.test.tsx#L286), [validated by omits the clock for a heartbeat that reports no elapsed time @a64cbc65](apps/web-ui/src/components/LogEntriesView.test.tsx#L300))

An unrecognized system entry renders as `· system: <subtype>` over its payload. ([validated by names the subtype of an unrecognized system entry @af1463c7](apps/web-ui/src/components/LogEntriesView.test.tsx#L316))

An agent-error entry of severity `error` renders with the error style, and one of severity `warning` dimmed. ([validated by renders an error-severity agent-error styled as an error @c3093b13](apps/web-ui/src/components/LogEntriesView.test.tsx#L324), [validated by renders a warning-severity agent-error dimmed, not as an error @351d3e45](apps/web-ui/src/components/LogEntriesView.test.tsx#L336))

A file entry renders as a collapsed details block summarized `⇢ <event> — <path>` over the delivered content. ([validated by renders the pr.description delivery as a collapsed details naming the event and path @febfed82](apps/web-ui/src/components/LogEntriesView.test.tsx#L356))

A never-produced artifact renders as an error line naming the event and the reason. ([validated by `LogEntriesView.test.tsx@4e640294`](apps/web-ui/src/components/LogEntriesView.test.tsx#L369))

The Raw/Formatted toggle marks the active option with `aria-pressed`. ([validated by `LogFormatToggle.test.tsx@b3fa983d`](apps/web-ui/src/components/LogFormatToggle.test.tsx#L9))

The toggle reports a click through `onRaw` and `onFormatted`. ([validated by `LogFormatToggle.test.tsx@ca4db021`](apps/web-ui/src/components/LogFormatToggle.test.tsx#L30))

#### Viewer integration

A run's turns span every visit of every node, so `segmentTurns` (`@/lib/turn-segments`) groups consecutive turns that share a node and an iteration into one segment and starts a new segment when either changes. ([validated by `turn-segments.test.ts@f15cccf2`](apps/web-ui/src/lib/turn-segments.test.ts#L31), [validated by `turn-segments.test.ts@62715dad`](apps/web-ui/src/lib/turn-segments.test.ts#L46), [validated by `turn-segments.test.ts@034101fe`](apps/web-ui/src/lib/turn-segments.test.ts#L69))

Turns with no node keep a segment of their own. ([validated by `turn-segments.test.ts@d2c1f57e`](apps/web-ui/src/lib/turn-segments.test.ts#L60))

`segmentLabel` reads `node · iteration N`, the bare node name when the iteration is unknown, and nothing for a segment with no node. ([validated by `turn-segments.test.ts@a2ed77ed`](apps/web-ui/src/lib/turn-segments.test.ts#L75), [validated by `turn-segments.test.ts@d07ae97c`](apps/web-ui/src/lib/turn-segments.test.ts#L79), [validated by `turn-segments.test.ts@ba0f9738`](apps/web-ui/src/lib/turn-segments.test.ts#L83))

The transcript panel classifies each segment's turns on their own, so each visit keeps its own conversation. The panel itself is specified in `specs/turn-level-transcript-store` FR5.
