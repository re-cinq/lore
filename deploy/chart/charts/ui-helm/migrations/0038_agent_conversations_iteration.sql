-- A conversation belongs to a NODE EXECUTION, not to an assembly line.
--
-- While every planning round ran as its own line, `assembly_line_id` identified a
-- round exactly. On the merged planning line (FR6.21) the rounds are revisits of one
-- node, so they all share that id: the "never resume yourself" guard excluded every
-- sibling round (continuity died silently, each round re-briefed from scratch) and a
-- rewind could not name which round it meant.
--
-- Existing rows keep a NULL iteration, which reads as "the only execution on its
-- line" — true for every row written before the merged line existed.
ALTER TABLE pipeline.agent_conversations
  ADD COLUMN IF NOT EXISTS iteration integer;

CREATE INDEX IF NOT EXISTS agent_conversations_execution_idx
  ON pipeline.agent_conversations (assembly_line_id, iteration);
