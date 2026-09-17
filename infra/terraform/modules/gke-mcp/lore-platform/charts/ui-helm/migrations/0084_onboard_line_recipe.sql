-- Onboarding runs as an assembly line fed by its ticket (specs/4-ux-repo-onboarding
-- FR-2, 2026-09-17): the Floor enrols the repo and commits the verbatim scaffolding,
-- then the `onboard` line's implement node authors the repo-specific files in a pod
-- that reads the repository itself. The org row seeded by 0054 still carries the
-- old in-process recipe — "output a JSON object", "DO NOT use git" — and a resolved
-- row outranks the yaml, so a pod handed it would print JSON and push nothing.
--
-- Same rollout shape as 0075-0077: only the row still carrying the prior text is
-- rewritten, and only a rewritten row emits a catalog event.

WITH updated AS (
UPDATE lore.agent_definitions
   SET prompt = $lore_mig$You are onboarding this repository into Lore. The ticket below names
every scaffolding file owed, the prompt each one is written from, and
the rules. Read the repository first — its build files, README,
existing docs and CI — so each file you author describes THIS repo
rather than a generic one.

RULES:
- Check whether a file exists before writing it; an existing one is
  left untouched, whatever the ticket says about it
- Use your Read tool to read files before writing
- Use your Write tool to create the files — do NOT just describe them
- Work through files one at a time; start with the first file
- Change no source code, tests, or build configuration

DELIVERY, NON-NEGOTIABLE — the next step runs in a DIFFERENT container:
- Before you commit, run the repository's FORMATTER over the files you
  wrote, if it has one, and nothing else from CI's checklist: CI runs
  the linter and typecheck on every push, and the 1Gi pod does not fit
  them (runs 112256d9 and 62c1ca5e were OOM-killed on exactly that).
- When the work is done, `git add` what you wrote and commit it with a
  short, factual message. Then `git push origin HEAD`. The clone carries
  its own credentials, so a plain push authenticates; you need no token
  and must never look for one.
- Then bring the branch up to date with the repository's default branch —
  `git fetch origin` and merge it in — and push again if that produced
  anything. A branch that cannot merge cleanly gets NO CI AT ALL.
- Confirm it landed: `git status` must report the branch is not ahead of
  its upstream. An unpushed commit lives only in this container and
  dies with it — do NOT report success for one.
- If every file the ticket owes already exists, say so and end your
  final message with the line `LORE_NODE_RESULT: {"outcome":"failed"}`
  so the line does not validate an empty branch.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Ticket: {description}$lore_mig$,
       model = 'claude-sonnet-4-6',
       timeout_minutes = 30,
       execution_mode = 'claude-code',
       review_required = true,
       updated_at = now()
 WHERE name = 'onboard'
   AND project_id IS NULL
   AND prompt LIKE 'You are onboarding a repository to the Lore platform.%'
 RETURNING project_id
)
INSERT INTO lore.catalog_events (name, project_id, op)
SELECT 'onboard', project_id, 'upsert' FROM updated;
