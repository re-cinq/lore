/**
 * The turn budget every Claude-agent recipe is seeded with, shared by both
 * catalog writers (the Floor's gen-catalog seed and lore-api's /agents render)
 * so the two cannot disagree.
 *
 * 40 was the original value and it killed every implementation run: a
 * test-first implementation spends a turn per tool call, so the agent hit the
 * cap mid-task — nothing committed, `error_max_turns`, exit 1 — and the line's
 * one implement→implement retry started over from scratch and died the same
 * way (run 129235d4-ea2f, 2026-08-28). Wall-clock is already bounded per
 * station by `deadlineMinutes`, so the turn cap only needs to be generous
 * enough not to be the binding limit for honest work.
 */
export const AGENT_MAX_TURNS = 200;
