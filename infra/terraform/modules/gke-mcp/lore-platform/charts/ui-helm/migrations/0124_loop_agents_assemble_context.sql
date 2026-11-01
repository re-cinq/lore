-- 0124_loop_agents_assemble_context: the loop agents call lore_assemble_context after reading the ticket.
SELECT lore.update_prompt('loop-dod', 'loop-dod.md');
SELECT lore.update_prompt('loop-tdd-round', 'loop-tdd-round.md');
SELECT lore.update_prompt('loop-fix-ci', 'loop-fix-ci.md');
SELECT lore.update_prompt('loop-sync', 'loop-sync.md');
