-- 0061_review_prompt_calibration: calibrate the code-review prompts after the
-- 2026-09-03 finding-quality audit (61 findings cross-checked on real PRs).
--
-- Three changes, applied to the REVIEW_FINDINGS instruction paragraph:
--   1. No praise/commentary findings — only problems worth acting on (the
--      Gemini reviewer posted 7 praise comments across 15 PRs; nobody reads
--      applause).
--   2. `"decoration":"blocking"` reserved for real defects (correctness,
--      security, data loss) — doc/spec hygiene and speculative hardening were
--      being stamped "blocking" (severity inflation, e.g. PR #1752's
--      Windows-path hardening on Linux-only Floor code).
--   3. One root cause = ONE finding — PR #1741 got the same stale-tag note
--      fanned out 11 times.
--
-- resolveAgentConfig prefers a lore.agent_definitions row's prompt over the
-- task-types.yaml template (the #1736 lesson), so the yaml edit in this branch
-- never reaches an environment whose rows were already seeded — this migration
-- rewrites the rows. Idempotent and edit-preserving: replace() swaps only the
-- exact old paragraph, so a hand-edited prompt without that text is untouched,
-- and a re-run finds nothing left to replace. The live rows carry CRLF line
-- endings (UI-seeded), so newlines are normalized to LF first — that is what
-- lets one LF-quoted paragraph match every row.

UPDATE lore.agent_definitions
   SET prompt = replace(replace(prompt, E'\r\n', E'\n'),
$lore_old$Emit a fenced REVIEW_FINDINGS block (one finding per point) then the
verdict. Be liberal with concrete `suggestion` fixes. Each `subject` is
ONE short imperative line. Labels: issue | suggestion | nit | question |
praise | thought | chore. Add `"decoration":"blocking"` to a must-fix
issue. `suggestion` is the replacement text for that exact line(s).$lore_old$,
$lore_new$Emit a fenced REVIEW_FINDINGS block (one finding per point) then the
verdict. Be liberal with concrete `suggestion` fixes. Each `subject` is
ONE short imperative line. Labels: issue | suggestion | nit | question.
Report only problems worth acting on — never praise, commentary, or
restatements of what the diff does; a clean area gets silence.
Reserve `"decoration":"blocking"` for real defects in the changed code:
correctness, security, or data loss. Convention/doc/spec hygiene, style,
and speculative hardening against situations this code cannot reach are
`suggestion` or `nit`, never blocking.
When one root cause repeats across files, emit ONE finding and list the
other occurrences in its subject — not one finding per site.
`suggestion` is the replacement text for that exact line(s).$lore_new$),
       updated_at = now()
 WHERE name = 'code-review'
   AND prompt LIKE '%praise | thought | chore%';

UPDATE lore.agent_definitions
   SET prompt = replace(replace(prompt, E'\r\n', E'\n'),
$lore_old$Emit a fenced REVIEW_FINDINGS block (it MAY be empty when nothing new is
wrong) then the verdict. Same schema as the full review:$lore_old$,
$lore_new$Emit a fenced REVIEW_FINDINGS block (it MAY be empty when nothing new is
wrong) then the verdict. Report only problems worth acting on — never
praise or commentary. Reserve `"decoration":"blocking"` for real defects
(correctness, security, data loss); hygiene and style are `nit`, never
blocking. Same schema as the full review:$lore_new$),
       updated_at = now()
 WHERE name = 'code-review-recheck'
   AND prompt LIKE '%wrong) then the verdict. Same schema as the full review:%';
