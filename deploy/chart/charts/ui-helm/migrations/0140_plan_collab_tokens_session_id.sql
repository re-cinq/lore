-- 0140_plan_collab_tokens_session_id: a plan collaboration token records the
-- session row it was minted for (FR-301), so it is refused once that session
-- ends (FR-286). Tokens minted before this column have no session and stay
-- valid until they expire.

ALTER TABLE lore.plan_collab_tokens
  ADD COLUMN IF NOT EXISTS session_id TEXT;
