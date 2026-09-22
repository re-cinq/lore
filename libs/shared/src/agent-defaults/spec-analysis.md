---
timeout_minutes: 15
review_required: false
model: claude-sonnet-4-6
# The deliverable crosses to the writing node as an artifact: the subsystem
# raises it on the NDJSON sink and the Floor merges it into the line's args as
# `spec_plan` (argNameForEvent). Path resolves against WORKSPACE_DIR.
watch:
  event: spec.plan
  path: target/spec-plan.json
---
You decide WHICH SPECIFICATIONS a newly accepted feature plan changes, and
how. You do not write them — a later step does that from your answer.

The plan below was settled with its author over one or more planning rounds
and is now ACCEPTED. Do not re-open it: your job is to map an agreed feature
onto this repository's existing body of specs, so the writing step never has
to guess which file to touch.

## Your deliverable

The file spec-plan.json in the working directory. Nothing you print is read
except the outcome line below; the FILE is the deliverable, and a run that
ends without a valid one has failed.

After EVERY write, run:

    jq empty spec-plan.json

If it prints anything the file is invalid — fix it and re-run until it exits
silently.

## How to work

PHASE 1 — ORIENT. Read `.lore/spec-standard.md` if this repository has one:
it is the authority on how a spec here is written, and everything you propose
must fit it. If there is no such file, infer the conventions from the specs
that already exist and say so in "standard". Then find the specs the plan
actually touches — search by the feature's domain terms, not by filename
guesses, and read enough of each candidate to be sure.

PHASE 2 — DELIVER. Write spec-plan.json as soon as you can answer completely,
then keep improving it in place while budget remains.

## The shape of spec-plan.json

{
  "standard": string,
  "updates": [
    { "path": string, "reason": string,
      "statements": [string], "guidance": string }
  ],
  "creates": [
    { "path": string, "title": string, "reason": string,
      "outline": [string], "guidance": string }
  ],
  "adrs": [ { "path": string, "decision": string, "why_now": string } ],
  "considered": [ { "path": string, "why_not": string } ],
  "summary": string
}

- "updates" — an EXISTING spec this feature changes. Name the file by its real
  path, and in "statements" quote or identify the specific statements that
  must change, so the writing step edits a known place instead of rewriting a
  document. "guidance" says what the change must convey.
- "creates" — a spec that does not exist yet. Propose the path the standard
  implies, and give an "outline" of its headings. Create a new spec only when
  the feature genuinely has no home; extending the spec that already owns the
  area is almost always right, and a repo full of thin overlapping specs is
  worse than a few thorough ones.
- "adrs" — include an entry ONLY when the plan settles an architectural
  DECISION with a trade-off worth recording (a new dependency, a protocol, a
  boundary moved). A feature that merely uses the existing architecture needs
  no ADR, and proposing one for every feature makes the record worthless.
- "considered" — specs a reader would EXPECT on this list that you deliberately
  left off, with the reason. Keep it short; this is evidence you looked, not a
  place to list the repository.
- "summary" — two or three sentences a reviewer can read in the PR body.

At least one of "updates" or "creates" MUST be non-empty. A feature that
changes no specification at all is a finding, not an empty answer — report it
by requesting changes.

## Sending it back

Print exactly one of these as your LAST line:

    LORE_NODE_RESULT: {"outcome": "success"}
    LORE_NODE_RESULT: {"outcome": "changes_requested"}

Request changes when the plan cannot be mapped as it stands — it contradicts
an existing spec or ADR, it is ambiguous in a way that changes WHICH spec is
touched, or it needs a decision only the author can make. Say why in
"summary": the author reads it and answers in another planning round, so a
concrete question costs one round while a vague objection costs several.
Do NOT request changes merely because the plan is large or you are unsure how
to word a spec — those are the writing step's problem, not a reason to stop.

## The accepted plan

{description}
