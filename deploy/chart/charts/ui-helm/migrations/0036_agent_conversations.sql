-- Conversations a run can continue (ai-agent-subsystem#188).
--
-- A run's agent conversation is saved so a LATER run can resume it instead of being
-- re-briefed from scratch. The bytes live in object storage through the same
-- ArchivePort that already archives the raw run stream — this table is only the index,
-- so nothing here grows with transcript size.
--
-- Keyed by (key_kind, key_value, node_id), never by anything feature-shaped: the
-- assembly-line engine names a thread with `continues.key` = `line` / `task` /
-- `args.<name>`, and knows nothing about features. Planning happens to key on
-- args.feature_id; another consumer could key on args.customer_id without a schema
-- change.

CREATE TABLE IF NOT EXISTS pipeline.agent_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'line' | 'task' | 'args' — how key_value was derived.
  key_kind         text        NOT NULL,
  -- The thread: an assembly-line id, a task id, or an arg's value.
  key_value        text        NOT NULL,
  -- The assembly-line node whose work this conversation is.
  node_id          text        NOT NULL,
  -- The CLI's own conversation id, passed back as `resources.conversation.id`.
  conversation_id  text        NOT NULL,
  -- ArchivePort key for the state archive. NULL while a run is in flight and the
  -- pod has not uploaded yet — a row exists from dispatch so the id is reserved.
  object_key       text,
  bytes            integer,
  -- Provenance: which run produced it. Deliberately no FK — losing a conversation
  -- because its line row was pruned would cost continuity for no benefit.
  assembly_line_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The dispatch lookup: newest conversation for a thread's node.
CREATE INDEX IF NOT EXISTS agent_conversations_thread_idx
  ON pipeline.agent_conversations(key_kind, key_value, node_id, created_at DESC);

-- The upload path resolves a row by the id the pod was told to save as.
CREATE UNIQUE INDEX IF NOT EXISTS agent_conversations_conversation_id_idx
  ON pipeline.agent_conversations(conversation_id);

GRANT ALL ON pipeline.agent_conversations TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.agent_conversations TO lore_ui';
  END IF;
END$$;

-- Rewind: which round a round forked from, so the history is a tree rather than a
-- list pretending to be one. NULL means "the previous round" (or the first round),
-- which is what every existing row is.
ALTER TABLE lore.feature_iterations
  ADD COLUMN IF NOT EXISTS parent_iteration integer;
