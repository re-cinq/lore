-- 0090_reset_planning_prompt: the planning agent now edits the plan as plan.md (ADR-047).
--
-- The org feature-planning prompt was edited away from its shipped default in
-- the features era, and the boot seed never overwrites an edited field. That
-- kept the wizard prompt, which answers with `{"sections": ...}`, so the Floor
-- rejected every draft as neither ops nor a section proposal and no plan was
-- ever written. The output contract changed, so the old wording cannot be kept:
-- clearing it lets lore-api's boot seed fill the shipped plans prompt. Numbered
-- 0090 because main's 0089 (llm_calls cache tokens) took 0089 while this waited.

UPDATE lore.agent_definitions
SET prompt = NULL
WHERE name = 'feature-planning'
  AND project_id IS NULL;
