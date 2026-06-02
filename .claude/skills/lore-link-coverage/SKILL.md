---
name: lore-link-coverage
description: Link spec statements to validating tests using your Claude Code subscription (BYO-compute). Walks through prepare → reason → persist for one or more specs and shows results in the Lore UI.
---

You are helping a developer link spec statements to the tests that validate
them, using THEIR Claude Code subscription for the LLM-y parts instead of
the server's API key. The server does all deterministic + trust-sensitive
work; you do the reasoning. The UI updates as soon as `persist_spec_link`
succeeds.

## Three MCP tools you'll use

- `list_stale_spec_coverage(repo?)` — returns specs whose hash drifted
  since the last link, never linked, or have zero statement rows. Pick
  what to work on.
- `prepare_spec_link(repo?, spec_path)` — returns spec content,
  deterministically segmented statements with section-heuristic
  classifications, candidate tests pre-filtered by assertion / directory /
  embedding signals, and a `content_hash`. Read-only on the server.
- `persist_spec_link(repo?, spec_path, content_hash, classifications,
  judgments, agent_id?)` — writes your decisions to the prod DB.
  Server validates everything and applies argmax-by-test dedup + the
  τ=0.5 score threshold. Returns the same coverage payload the UI reads.

`repo` is auto-detected from the current git remote when omitted.

## Entry

The developer runs `/lore-link-coverage [repo] [spec_path?]`.

- **No args**: detect the current repo, call `list_stale_spec_coverage`,
  show the list, ask which (or "all").
- **`repo` only**: same as above but for that repo.
- **`repo` + `spec_path`**: skip the list, go straight to that one spec.

## The flow, per spec

### Step 1 — Prepare

Call `prepare_spec_link(repo, spec_path)`. The response has:

```
content                      — reassembled spec markdown
content_hash                 — echo this back in persist
statements[]                 — every segmented statement, with
                               { ordinal, text, kind, enclosing_heading,
                                 heuristic: { testability, category,
                                              matched_by_section } }
candidate_tests[]            — tests pre-filtered for this spec, with
                               { test_file, test_name, test_line,
                                 content_snippet, match_kind, symbol,
                                 coverage_hits }
candidate_truncated          — true if more tests existed than the cap
assertion_hints              — optional list of symbol names from cache
```

Show the developer a short summary:

> Got the spec. 24 statements segmented:
>   • 8 already classified untestable by the section heuristic
>   • 16 need a classifier decision
>   • 14 candidate tests pre-filtered (no cap hit)

### Step 2 — Classify the unknowns

For every statement where `heuristic.matched_by_section === false`, decide
testable vs untestable.

- **Testable**: a concrete behaviour, requirement, or named symbol the
  spec promises. Things a test could verify.
- **Untestable**: narrative — intro, vision, background, clarification,
  open-question, limitation, rationale. Pick the closest category from
  that list when marking untestable.
- **Bias toward testable** when you're not sure. A false "testable" shows
  up as a visible red gap in the UI; a false "untestable" hides a real
  gap behind grey. The first is harmless, the second is dangerous.

Build a `classifications` array of `{ ordinal, testability, category? }`
entries. Skip statements where `matched_by_section === true` — the server
ignores them because the section heuristic wins on locked categories.

### Step 3 — Judge candidate tests

For each candidate test, decide which **single** testable statement it
most strongly validates.

- Read `content_snippet` (and `coverage_hits` when present — those are
  ground-truth execution traces, the strongest possible signal).
- Pick the testable statement (by `ordinal`) whose behaviour the test
  exercises. Use the `assertion_hints` and the candidate's `symbol` /
  `match_kind` as supporting evidence.
- Assign a `score` in `[0.5, 1]`:
  - **0.9-1.0** — coverage hits OR the test literally exercises the named
    symbol AND the rationale is one sentence away from obvious.
  - **0.7-0.9** — clear behavioural match, no ambiguity.
  - **0.5-0.7** — plausible but the test could arguably validate a
    different statement instead.
  - **< 0.5** — DROP IT. Don't include the judgment. The server will
    reject the row anyway; saving the round-trip.
- Write a one-sentence `rationale` that names the behaviour, not the
  vocabulary.

A test that doesn't clearly validate any testable statement → skip it.
Empty judgments is a valid persist body — the UI will show those
statements red (untested).

A single statement can be the best match for several tests; one test
can only ever be the best match for one statement. The server applies
`argmaxByTest` on the judgments array, so if you accidentally emit two
judgments for the same `(test_file, test_name)` the lower-scoring one
gets dropped server-side. Don't rely on it; do the dedup mentally.

### Step 4 — Persist

Call `persist_spec_link(repo, spec_path, content_hash, classifications,
judgments)`. Outcomes:

- **200 OK** → done. Show the coverage delta (testable / covered /
  untestable counts) and the UI URL:
  `${LORE_UI_URL}/repos/${owner}/${repo}/specs/${encodeURIComponent(spec_path)}`
- **409 `content_hash_stale`** → the spec changed mid-conversation
  (someone ingested it while you were reasoning). Call
  `prepare_spec_link` again, redo any statements whose text changed,
  retry persist. Tell the developer this happened — it's transparent
  to them but worth surfacing.
- **400 `invalid_ordinal`** → you referenced an ordinal not in the
  segmenter output, OR a judgment's `statement_ordinal` is not in the
  testable subset after your classifications. Re-check your inputs;
  most often a typo or a mid-conversation reasoning slip. Do NOT retry
  blindly — fix the data first.
- **400 `invalid_score`** → a score is outside `[0.5, 1]`. Drop the
  offending judgment (or raise its score if you genuinely think it
  belongs).

## Multi-spec batch

When the developer picked "all":

1. Get the full stale list.
2. Sort it: never-linked first (highest value), then hash-drifted, then
   zero-statement rollbacks.
3. Loop the per-spec flow. After each spec, show a one-line summary and
   prompt: "Continue to spec N/M, or stop?" so the developer can break
   out without losing in-flight work (the previous spec is already
   persisted).
4. End with a summary: total specs linked, total statements written,
   total test links written, approximate seat token spend (rough — Claude
   Code doesn't expose per-conversation totals at MCP-tool granularity;
   just say "subscription tokens used; no API spend on the server").

## What NOT to do

- **Never invent ordinals.** Only use ordinals that came back from
  `prepare_spec_link`. The server validates this.
- **Never set a score above 1 or below 0.5.** The server rejects with
  `invalid_score`.
- **Never reuse a `content_hash` across specs.** Each spec has its own.
- **Never write multiple judgments for the same `(test_file, test_name)`
  in a single persist call.** Pick the highest-scoring one yourself.
- **Don't paste the spec text back into the persist body.** The server
  re-segments authoritatively; what you send is metadata, not content.

## Example transcript

A frozen example showing one full pass on a hand-crafted demo spec
lives at `.claude/skills/lore-link-coverage/example.md`. Read it once
to calibrate; don't paste it back as output.
