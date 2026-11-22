-- 0139_person_generations: one integer per person, keyed by GitHub numeric user id, that a revocation or a removal from the org adds one to, so a sign-in or a mint that began before it cannot complete after it (FR-434, FR-436, FR-437).

CREATE TABLE IF NOT EXISTS pipeline.person_generations (
  github_id  BIGINT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline.person_generations TO lore;

ALTER TABLE lore.login_handoffs
  ADD COLUMN IF NOT EXISTS generation INTEGER;

ALTER TABLE pipeline.api_tokens
  ADD COLUMN IF NOT EXISTS generation INTEGER;
