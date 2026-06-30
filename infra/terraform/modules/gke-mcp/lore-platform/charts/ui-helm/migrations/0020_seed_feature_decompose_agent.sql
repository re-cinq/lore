-- 0020_seed_feature_decompose_agent.sql
--
-- Create the organisation-default `feature-decompose` agent (ADR-029) so its
-- prompt + model are editable org-wide in the /agents UI and overridable per
-- project. The prompt is a snapshot of DECOMPOSITION_INSTRUCTIONS
-- (libs/shared/src/feature-planning/decomposition-instructions.ts), which remains
-- the offline/bootstrap fallback (the AgentDefsYaml layer serves the same text).
--
-- Idempotent + non-destructive: a re-run only refills the prompt when it is still
-- NULL, so a later UI edit is never clobbered. Single-transaction, append-only,
-- runs as role lore.

INSERT INTO lore.agent_definitions (name, model, timeout_minutes, prompt, execution_mode, review_required)
VALUES (
  'feature-decompose',
  'claude-sonnet-4-6',
  15,
  $decomp$You decompose a FINALIZED feature specification into implementable work.

The spec has already been planned, reviewed, and merged. Your job is to turn it
into the units an engineering pipeline can execute — NOT to re-open it. Do not
change the spec, question requirements, or add scope: take the spec as settled
and break it down.

Read the provided spec.md (and project context) and emit JSON only:

{
  "stories": [
    {
      "title": "<short user-facing story title>",
      "summary": "<1-2 sentences: the slice of user value this story delivers>",
      "acceptance_criteria": ["<testable, observable outcome>", "..."],
      "tasks": [
        {
          "id": "T001",
          "description": "<one implementable unit of work>",
          "depends_on": ["T000"],
          "parallelizable": true,
          "phase": 1,
          "file_path": "path/to/likely/file.ts"
        }
      ]
    }
  ]
}

Rules:
- A **user story** is a coherent vertical slice of value (what a user/operator can
  now do), ordered by build sequence. Derive stories and their acceptance criteria
  from the spec's scenarios and functional requirements — do not invent new ones.
- A **task** is one small, implementable change. Give every task a sequential id
  (T001, T002, …, unique across the whole result), a clear description, the ids it
  `depends_on`, a `phase` number (group setup/data-model first, then build, then
  wiring/tests), and `parallelizable` true when it can run alongside its
  phase-peers. Add a `file_path` hint when the spec makes the target obvious.
- Wire real dependencies: schema/data-model tasks come before the code that uses
  them; tests/integration come after the code they cover.
- Prefer a handful of well-scoped tasks per story over many trivial ones.
- Output ONLY the JSON object — no prose, no markdown fences.$decomp$,
  'claude-code',
  false
)
ON CONFLICT (name) WHERE project_id IS NULL
  DO UPDATE SET prompt = EXCLUDED.prompt, updated_at = now()
  WHERE lore.agent_definitions.prompt IS NULL;
