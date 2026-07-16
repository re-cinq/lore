# Feature Specification: Passive Session Tracking

| Field   | Value                    |
|---------|--------------------------|
| Feature | Passive Session Tracking |
| Status  | Shipped                  |
| Owner   | Platform Engineering     |

Passive Session Tracking records every MCP tool call in a per-session ring buffer and, on exit, dumps a session summary for automatic episode and fact extraction with no agent cooperation; this spec documents the tracker's contract so its unit tests trace to a statement.

## Problem Statement

The MCP server passively records every tool call in a session (a ring buffer)
and, on exit, dumps a session summary for automatic episode + fact extraction —
no agent cooperation required. This spec documents the session tracker's contract
so its unit tests trace to a statement.

## Functional Requirements

<!--
  One statement per tracker behaviour; link its unit tests inline (v3):
  `Statement. ([validated by `session-tracker.test.ts:NN`](path#LNN))`.
-->

### Session summary formatting

FR1. An empty session log produces an empty summary string, so a session that made no tool calls emits nothing. ([validated by `session-tracker.test.ts:67`](libs/server-core/src/platform/session-tracker.test.ts#L67))

FR2. The summary reports the total tool-call count, the total error count, and a per-tool breakdown of how many times each tool was called. ([validated by `session-tracker.test.ts:73`](libs/server-core/src/platform/session-tracker.test.ts#L73))

FR3. Each tool's per-tool line appends an error count suffix when that tool had at least one failed call, and the header carries the session-wide error total. ([validated by `session-tracker.test.ts:105`](libs/server-core/src/platform/session-tracker.test.ts#L105))

FR4. Tools in the breakdown are ordered by call count descending, so the most-used tool appears first. ([validated by `session-tracker.test.ts:130`](libs/server-core/src/platform/session-tracker.test.ts#L130))

FR5. Each tool's per-tool line reports the average call duration in milliseconds across that tool's calls. ([validated by `session-tracker.test.ts:168`](libs/server-core/src/platform/session-tracker.test.ts#L168))

### Ring buffer

FR6. The tool-call log is a ring buffer capped at MAX_ENTRIES (500): once full, the oldest entry is evicted as each new call is recorded. ([validated by `session-tracker.test.ts:193`](libs/server-core/src/platform/session-tracker.test.ts#L193))
