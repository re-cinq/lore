# Implementation Plan: Auto-Episode Hooks

| Field   | Value              |
|---------|--------------------|
| Feature | Auto-Episode Hooks |
| Spec    | [spec.md](spec.md) |
| Status  | Complete           |
| Created | 2026-04-03         |

## Files Changed

| File | Change |
|------|--------|
| `agent/src/jobs/review-reactor.ts` | Added episode capture: writes PR review feedback as an episode before processing. Source: `pr-review`, ref: `owner/repo#PR`. |
| `scripts/lore-merge-settings.js` | Added `Stop` hook that curls `/api/episode` to capture session summary. |
| `mcp-server/src/index.ts` | Added `/api/episode` REST endpoint for hook-based episode ingestion. |
