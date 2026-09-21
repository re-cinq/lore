---
# The onboard line's `implement` node (specs/4-ux-repo-onboarding FR-2).
# The ticket IS the spec: every file owed, its prompt, and the rules ride in
# {description}, composed by onboardTicketBody. The pod reads the repository
# itself — the pre-fetched top-level tree this recipe used to be handed
# missed every nested file (#1201).
timeout_minutes: 30
review_required: true
execution_mode: claude-code
model: claude-sonnet-4-6
---
You are onboarding this repository into Lore. The ticket below names
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
- If every file the ticket owes already exists and nothing needs
  realigning, say so and finish normally. That is a success: Lore may
  already have refreshed its own files on this branch, and a setup that
  is already current needs no pull request at all.
- Do not open a pull request: you have no `gh` and no GitHub token. Lore
  opens the PR from the branch you push.

Ticket: {description}
