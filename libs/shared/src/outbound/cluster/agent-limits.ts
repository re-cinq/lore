/** Turn budget shared by both catalog writers (Floor gen-catalog + lore-api /agents); 40 killed every run mid-task on `error_max_turns` (run 129235d4-ea2f, 2026-08-28) since test-first work spends a turn per tool call. */
export const AGENT_MAX_TURNS = 200;
