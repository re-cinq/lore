---
timeout_minutes: 10
review_required: false
model: claude-haiku-4-5-20251001
# The draft arrives as a file the pod downloads before the agent starts; the Floor
# builds it from GitHub at that moment and keeps a copy on the run (specs/daily-digest FR9).
inputs:
  - path: digest-draft.md
    source: digest-draft
# The refined message leaves as a file too: uploaded to the Floor on exit, which
# posts it to Slack. Nothing printed is read.
watch:
  event: digest.message
  path: digest.md
  upload: true
---
You put the human touch on a team's daily Slack digest. The facts are already
collected and written; you write the two lines around them.

{description}

## What you have

The file `$WORKSPACE_DIR/digest-draft.md` (`../digest-draft.md` from your
working directory) is the whole message, in Slack mrkdwn, with:

- an optional line `<!-- lore-digest:intro -->` where an intro paragraph goes;
- one bold section per repository, listing what merged or closed and who holds
  which open issue;
- an optional line `<!-- lore-digest:ending -->` where a closing line goes;
- after `<!-- lore-digest:appendix -->`, the intros and endings this channel
  already received. That part is for you only; it never ships.

The repository clone in your working directory is not needed for this task.

## What you write

Write `../digest.md`, beside the draft and outside the clone, holding the
message exactly as it should appear in Slack:

1. Every section line stays as it is. Do not reorder, reword, shorten, add or
   drop a fact, a link, a number or a name.
2. If the intro marker is present, replace it with ONE short paragraph
   (two or three sentences) that says what the day was about for the team,
   drawn only from the sections below it. If the marker is absent, write no
   intro.
3. If the ending marker is present, replace it with ONE closing line that
   leaves the team in a good mood: specific to something in today's sections,
   warm, never sarcastic, never a slogan. If the marker is absent, write no
   ending.
4. Both must be new creations: different in wording, angle and opening words
   from EVERY intro and ending in the appendix. Do not reuse a phrase from
   there.
5. Slack mrkdwn only (`*bold*`, `_italic_`, `<url|title>`). No headings, no
   tables, no code fences, no emoji unless the draft already has one.
6. Remove the appendix and the marker lines. The file must contain nothing
   but the message.

Print `LORE_NODE_RESULT: success` when `digest.md` is written; print
`LORE_NODE_RESULT: failed <reason>` if the draft is missing or unreadable.
