# Definition of Done

> A repo agent override copies the whole prompt, so a shipped-default prompt change never reaches that repo

**Strategy: `direct`** — The seam is `agentFormValues` in `apps/web-ui/src/app/repos/[owner]/[repo]/agents/agent-form-values.ts`. It sets `prompt: isNew ? "" : (agent?.prompt ?? "")`, which prefills the textarea with the inherited org prompt. The form then submits that value, creating a project row with the copied prompt even when the user never touched it.

## Done when these pass

- [x] **does not prefill the prompt textarea for an inherited org agent — so an unmodified save does not copy the org prompt** — renders `AgentForm` with an org agent (`project_id: null`) and asserts the prompt textarea's value is `""`, with the placeholder showing the inherited value; currently fails because `agentFormValues` returns `prompt: "base prompt"` instead of `""`
  `apps/web-ui/src/app/repos/[owner]/[repo]/agents/AgentForm.test.tsx`

## Facets

- [x] Fix `agentFormValues` in `agent-form-values.ts`: change `prompt: isNew ? "" : (agent?.prompt ?? "")` to `prompt: isNew || agent?.project_id == null ? "" : (agent?.prompt ?? "")` so org agents (project_id=null) yield an empty textarea
- [x] Verify the test turns green
- [x] Consider whether `timeout_minutes` and `model` need the same treatment (the ticket calls out prompt specifically; model was intentionally set by the user in the reported incident) — decided out of scope per ticket; prompt is the only field with the silent-copy problem the ticket describes

## Out of scope

- The migration/one-off to null existing project rows whose fields match the org row's value — that is a separate data cleanup task named in the ticket
- The optional seed-log guard extending to project rows that shadow a field the file just changed
- The model and timeout fields — the ticket's central claim is the prompt; model was intentionally set
