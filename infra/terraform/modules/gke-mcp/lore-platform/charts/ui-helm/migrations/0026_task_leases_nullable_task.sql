-- Detection assembly lines (ADR-019 amendment) hold branch leases without a
-- backing pipeline task: the branch name detect/<definition>/<repo> is a pure
-- lease key. Allow NULL task_id; the FK still validates non-null values.
ALTER TABLE pipeline.task_leases ALTER COLUMN task_id DROP NOT NULL;
