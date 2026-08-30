---
name: legacy-characterize
description: Pin the CURRENT behaviour of existing code with characterization tests before changing it. Use when there is no seam to test against and the change is diffuse, so a refactor would otherwise run with no green bar underneath it. Covers finding or introducing a seam, documenting reality rather than intent, and the order to cover branches in.
---

This is the authoritative copy of Lore's characterization-testing contract for agent
runs. It is checked into the Lore repo at
`apps/mcp-server/agent-skills/skills/legacy-characterize/` and served to pods by the
gateway's `/skills` registry.

Use this when the code you must change has **no seam** to write a test against and the
change is **diffuse** — spread across many call sites, with no single module you could
build a replacement beside. Pinning current behaviour first is what gives the later
refactor a green bar to stay green against.

If a seam already exists, you do not need this: test through it directly. If the change
has a clean boundary, prefer building the replacement beside the old code and pointing
the new tests at that — the old code then never moves while the new one is red.

## Find or create a seam first

A **seam** is a place where behaviour can be swapped without editing the code there — a
constructor parameter, an injected dependency, a function argument.

- If no seam exists, introduce one **in its own commit**, before writing any tests.
- Verify behaviour is unchanged after introducing it.
- Introducing a seam is a structural change only. It adds no behaviour.

## Writing the tests

**You are documenting reality, not intent.** Write a test, run it, and copy the *actual*
output into the assertion.

- If the output surprises you, **note it and do not fix it**. Fixing comes after the
  safety net exists — that is the entire point of the safety net.
- Test through the public entry point. Do not reach into internals.
- One rule per test, so a failure identifies exactly which rule broke.
- Name tests after the **rule**, not the code path: `quality never exceeds 50`, not
  `else branch`.
- **Never change source code while adding tests.** Separate commits, always.

## What to cover

Map every branch before writing anything. Then cover the happy path, each special case,
boundary values, and the behaviour on both sides of every threshold. Use a data table
for boundary cases rather than copy-pasting near-identical tests.

## Order

1. The simplest inert case — nothing changes.
2. The normal path with typical inputs.
3. The normal path at, and just past, a boundary.
4. Floor and ceiling constraints.
5. Each named special case, before and after its boundary.
6. Only then the new behaviour — write that test last, let it fail, and implement it
   under the `tdd-loop` contract.

## Handing off

Characterization tests are a scaffold with a real cost: they pin behaviour that may be
wrong, and a later intentional change has to update them deliberately. Say in your
commit message which tests are characterization tests, so the next reader knows they
document what the code *does* rather than what it *should* do.
