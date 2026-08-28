-- 0052_pod_log_chunks: durable per-pod stdout, so a node's logs survive the pod
-- that produced them AND are readable for a run executed in a cluster the Floor
-- cannot reach.
--
-- Pod logs are read live today: browser -> web-ui -> Floor -> cluster-agent ->
-- kube API, with a Cloud Logging fallback once the pod is garbage-collected.
-- Both halves are CENTRAL-ONLY. The Floor dials one CLUSTER_AGENT_URL, and the
-- Cloud Logging filter names the central project -- so a run claimed by a
-- satellite has no log path at all, live or archived. This table is the third
-- source, and the only one that works for a cluster reporting inward.
--
-- NO FOREIGN KEYS, for the reason 0031 gives at length: ingest is a batch
-- insert on a skip-not-fail path, and one unknown id under an FK aborts the
-- whole statement and drops the batch.
--
-- (job_name, seq) is the read key: `PodLogArchive.logsForJob` is what the
-- Floor's existing fallback seam asks for, and seq is assigned per pod by the
-- producer so a reassembled log keeps the order the pod emitted it in. UNIQUE
-- on (pod_name, seq) makes a redelivered batch a no-op rather than a duplicated
-- span of log -- the producer retries through the event proxy, so redelivery is
-- expected, not exceptional.
--
-- Idempotent: safe to re-run. Created/owned by `lore`; `lore_ui` (web-ui) gets
-- SELECT, guarded like 0009 and 0031.

CREATE TABLE IF NOT EXISTS pipeline.pod_log_chunks (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_cr_name TEXT        NOT NULL,
  job_name      TEXT        NOT NULL,
  pod_name      TEXT        NOT NULL,
  seq           INT         NOT NULL,
  lines         TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the reassembly read: one job's chunks in the order the pod emitted them
CREATE INDEX IF NOT EXISTS pod_log_chunks_job_idx
  ON pipeline.pod_log_chunks(job_name, seq);

-- the retention prune scan (14 days, matching agent_run_events)
CREATE INDEX IF NOT EXISTS pod_log_chunks_created_idx
  ON pipeline.pod_log_chunks(created_at);

-- a redelivered batch collapses instead of duplicating a span of log
CREATE UNIQUE INDEX IF NOT EXISTS pod_log_chunks_pod_seq_idx
  ON pipeline.pod_log_chunks(pod_name, seq);

GRANT ALL ON pipeline.pod_log_chunks TO lore;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lore_ui') THEN
    EXECUTE 'GRANT SELECT ON pipeline.pod_log_chunks TO lore_ui';
  END IF;
END$$;
