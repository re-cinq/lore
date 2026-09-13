# Definition of Done

> Run-viz projection drops all gemini stream-json events — live visualization
> empty for Gemini runs. The Floor's `rowsFromEvent`
> (`apps/floor/src/work/agent/agent-run-events.ts`) only matches Claude
> stream-json shapes (`type: system/assistant/user/log/result`) [...] The
> GeminiAgent vendor emits gemini-cli's flat dialect — `init`, `message` with
> string content, top-level `tool_use`/`tool_result`, `error`, and a `result`
> keyed by `status` — and every one of those falls into the projection's
> silent-drop forward-compat branch. Consequence: `pipeline.agent_run_events`
> gets no rows for a Gemini run, so the live run visualization shows an empty
> conversation for its nodes.

**Strategy: `direct`** — the seam already exists. `parseAgentSink(ndjson).runEvents`
is the projection's real entry point (the existing tests drive it through the
`parseRunEvents` helper), and it feeds `rowsFromEnvelope` → `rowsFromEvent`. The
acceptance tests hand it gemini-dialect NDJSON lines and observe the projected
rows, so they fail today on the absent behaviour, not on wiring.

## Done when these pass

- [x] **projects the gemini conversation, not only its terminal result line** —
  a gemini run (init + string message + top-level tool_use + tool_result +
  result) projects `init` / `message` / `tool_call` / `tool_result` rows, and
  the tool_call carries `toolName`/`toolUseId` from `tool_name`/`tool_id`. Today
  the projected set is `[ 'result' ]` — the conversation is empty.
  `apps/floor/src/work/agent/agent-run-events.test.ts`
- [x] **reads a gemini tool_result's error from its status field, not is_error**
  — a top-level `tool_result` with `status:"error"` projects an error row; one
  with `status:"success"` does not; `toolUseId` comes from `tool_id`.
  `apps/floor/src/work/agent/agent-run-events.test.ts`
- [x] **projects a gemini error line instead of dropping it** — a top-level
  `error` line projects at least one row marked `isError`.
  `apps/floor/src/work/agent/agent-run-events.test.ts`

## Facets

- [x] Map gemini `init` → `init` row (model in summary).
- [x] Map gemini `message` (string `content`) → `message` row; the delta-chunk
      fold (`delta:true`) so assistant prose is one row, not one per fragment.
- [x] Map top-level gemini `tool_use` (`tool_name`, `tool_id`, `parameters`) →
      `tool_call` row, reusing `filePathsFromToolInput` on `parameters`.
- [x] Map top-level gemini `tool_result` (`tool_id`, `output`/`error`,
      `status`) → `tool_result` row, `isError` from `status === "error"`.
- [x] Map gemini `error` → a row marked `isError` (no dedicated enum slot;
      `message` eventType is the natural fit).
- [x] Keep FR1.5 intact: a genuinely-unknown `type` still drops silently.

## Out of scope

- The gemini cost/token projection (`stats`), which `parseAgentSink` already
  handles in `agent-events.ts`.
- The web-ui classifier (`agent-log-gemini-dialect.ts`, #1715) — it already
  speaks the dialect and serves only as the field-mapping reference here.
- Any change to the SSE stream, node-status derivation, or the seven
  `eventType` enum values (FR1.4).
