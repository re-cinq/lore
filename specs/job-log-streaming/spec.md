# Feature Specification: Job Log Streaming in Pipeline UI

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Job Log Streaming                        |
| Branch         | feat/job-log-streaming                   |
| Status         | Shipped                                  |
| Created        | 2026-04-01                               |
| Owner          | Platform Engineering                     |
| Target         | 3-5 days                                 |

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

1. Running task shows live logs in pipeline detail page. ([validated by `TaskLogs.test.tsx:92`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L92))

2. Logs update every 5s while task is running. ([validated by `TaskLogs.test.tsx:491`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L491))

3. Completed/failed tasks show final output. ([validated by `TaskLogs.test.tsx:527`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L527))

4. No kubectl access needed to see what the agent is doing

## Component Contract

### TaskLogs viewer

The initial fetch requests the bare logs URL with no `offset` query; a non-active (terminal) status never takes the offset branch. ([validated by `TaskLogs.test.tsx:75`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L75))

Before any logs resolve — or when the server returns null logs — the viewer shows the placeholder "Logs will appear when the agent starts.", and the "Agent Output" heading always renders. ([validated by `TaskLogs.test.tsx:54`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L54), [validated by `TaskLogs.test.tsx:549`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L549))

Status maps to a badge: "Completed" for succeeded/pr-created/merged, "In Review" for review, "Failed" for failed/cancelled; a running task that later reports completion transitions from the polling note to the Completed badge. ([validated by `TaskLogs.test.tsx:112`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L112), [validated by `TaskLogs.test.tsx:126`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L126), [validated by `TaskLogs.test.tsx:140`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L140), [validated by `TaskLogs.test.tsx:154`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L154), [validated by `TaskLogs.test.tsx:168`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L168), [validated by `TaskLogs.test.tsx:182`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L182), [validated by `TaskLogs.test.tsx:565`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L565))

While running, the viewer renders a pulse indicator and a "Polling every 5s — N.N KB received" note, collapsing to a bare "Polling every 5s" when zero bytes have been received. ([validated by `TaskLogs.test.tsx:196`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L196), [validated by `TaskLogs.test.tsx:218`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L218))

Once totalSize is known and the task is running, incremental polls use the `?offset=` URL and append the returned tail; an empty offset delta is not appended and does not blank the head chunk, and a still-null buffer coalesces to "" before the first appended tail. ([validated by `TaskLogs.test.tsx:235`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L235), [validated by `TaskLogs.test.tsx:274`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L274), [validated by `TaskLogs.test.tsx:297`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L297))

The full (non-offset) fetch path replaces the log buffer entirely. ([validated by `TaskLogs.test.tsx:333`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L333))

Fetch failures surface distinct messages: a 403 renders the access-denied message and stops polling, a 401 renders the sign-in message, any other non-ok response renders an "HTTP <code>" message, a thrown fetch renders the rejection message, and a later successful fetch clears the error. ([validated by `TaskLogs.test.tsx:352`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L352), [validated by `TaskLogs.test.tsx:387`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L387), [validated by `TaskLogs.test.tsx:409`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L409), [validated by `TaskLogs.test.tsx:429`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L429), [validated by `TaskLogs.test.tsx:446`](apps/web-ui/src/app/tasks/[id]/TaskLogs.test.tsx#L446))

### FailurePanel

FailurePanel renders nothing when the metadata carries neither an error nor any detail rows — undefined fields, an empty details array, or undefined metadata. ([validated by `FailurePanel.test.tsx:9`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L9), [validated by `FailurePanel.test.tsx:15`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L15), [validated by `FailurePanel.test.tsx:23`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L23))

A top-level error renders the "Failure" heading and the error paragraph; detail rows alone, with no top-level error, still render the heading and their error text. ([validated by `FailurePanel.test.tsx:34`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L34), [validated by `FailurePanel.test.tsx:162`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L162))

The category badge maps a known code to its human label, falls back to the raw code string when unmapped, shows "Unknown" for the reserved `unknown` code, and is omitted entirely when no category is present. ([validated by `FailurePanel.test.tsx:42`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L42), [validated by `FailurePanel.test.tsx:52`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L52), [validated by `FailurePanel.test.tsx:177`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L177), [validated by `FailurePanel.test.tsx:62`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L62))

A remediation hint renders under a "How to fix:" label and is omitted when no hint is provided. ([validated by `FailurePanel.test.tsx:70`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L70), [validated by `FailurePanel.test.tsx:81`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L81))

Error text is linkified — a file path inside the top-level error becomes a GitHub blob link opening in a new tab. ([validated by `FailurePanel.test.tsx:86`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L86))

Per-step detail rows render the step code with its own category badge, error, and linkified hint; the badge and hint are omitted when a detail lacks them, and multiple rows preserve their declared order. ([validated by `FailurePanel.test.tsx:102`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L102), [validated by `FailurePanel.test.tsx:129`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L129), [validated by `FailurePanel.test.tsx:143`](apps/web-ui/src/app/tasks/[id]/FailurePanel.test.tsx#L143))
