-- 0141_session_ended_notify: ending a session sends a PostgreSQL notification that names the session's id (FR-302), so every lore-api replica can close what it holds for that session (FR-303).
--
-- A trigger rather than an app-level publish: a session ends by sign-out, row revocation, access revocation or deletion, and each of those writes pipeline.api_tokens. The payload is the id alone.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION pipeline.notify_session_ended() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('lore_session_ended', OLD.id::text);
    RETURN OLD;
  END IF;
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    PERFORM pg_notify('lore_session_ended', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_tokens_session_ended_update ON pipeline.api_tokens;
CREATE TRIGGER api_tokens_session_ended_update
  AFTER UPDATE OF revoked_at ON pipeline.api_tokens
  FOR EACH ROW EXECUTE FUNCTION pipeline.notify_session_ended();

DROP TRIGGER IF EXISTS api_tokens_session_ended_delete ON pipeline.api_tokens;
CREATE TRIGGER api_tokens_session_ended_delete
  AFTER DELETE ON pipeline.api_tokens
  FOR EACH ROW EXECUTE FUNCTION pipeline.notify_session_ended();
