---
name: prototype-text-output
description: Sketch what a command, a log line, a Slack post or a pull request comment will print, character for character, as plain text for the plan's Prototype section. Use when a plan adds or changes text a person reads outside a web page. The wording is the product's, taken from the code and the plan.
---

# Prototype: terminal and text output

A plain-text sketch of exactly what a person will read: the terminal
after a command, a bot's Slack message, the comment a station posts on
a pull request. A reader judges the wording, the order and the length
before it ships.

## When to use

- The plan adds or changes a CLI command's output or its errors.
- The plan adds or changes a Slack post, an email, an issue or pull
  request comment, a check run summary or a log line people read.

Not for a web screen: that is a UI sketch. Not for a machine payload:
that is an API sketch.

## Method

1. Find the code that prints today in /workspace/target (the command,
   the message builder, the comment template) and copy its voice: its
   prefixes (`[lore]`), its casing, its markdown flavour, its emoji
   use or lack of it, how it writes counts and links.
2. Write the output for the case the plan is about, character for
   character, with realistic values: real repository names, plausible
   ids, numbers that add up.
3. Add the failure the plan names, as a second block under a line
   `--- when <case>`.
4. For markdown that a platform renders (a pull request comment, a
   Slack post), write the source the code will send, not the rendered
   look, so the spec writer can copy it.
5. Keep terminal lines under 100 characters, as a terminal shows them.

## Format

- `format: "text"`, `kind: "text-output"`, id `m-text-output-<n>`.
- Plain text, kept verbatim: spacing and blank lines matter.
- No secrets or real personal data; write `<token>`.
- `height`: 18 px per line plus 24.

## Worked example

Caption: `lore-doctor reports a stale skill`

```
$ scripts/lore-doctor
[lore] checking the install in /home/dev/.claude
[lore] ok      mcp server lore-context answers (v0.42.1)
[lore] ok      14 skills installed
[lore] FAIL    skill prototype-ui differs from the checkout
[lore]         run scripts/install.sh to refresh it
[lore] 1 problem found
--- when everything is current
$ scripts/lore-doctor
[lore] checking the install in /home/dev/.claude
[lore] ok      mcp server lore-context answers (v0.42.1)
[lore] ok      14 skills installed
[lore] all good
```

Height 260.

## Help

<!-- lore-help:begin -->
**Summary.** Sketch what a command, Slack post or pull request comment will print, character for character, in the product's own wording.
**Usage:** `/prototype-text-output`
**Use when.** A plan adds or changes text a person reads outside a web page and its Prototype section needs a text sketch.
**Related:** `/prototype-api`, `/prototype-ui`
<!-- lore-help:end -->
