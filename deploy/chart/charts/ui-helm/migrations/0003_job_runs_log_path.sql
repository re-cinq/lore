-- 0003_job_runs_log_path: add log_path column to pipeline.job_runs.
--
-- Written by the agent's generic job-runner (the new K8s CronJob path
-- introduced by the scheduled-job-runtime-split feature, ADR-019). Each
-- CronJob pod tees its stdout/stderr, redacts it, uploads to GCS under
-- __job_runs__/<job_name>/<run_id>/output.log, and writes the resulting
-- key here. The web-ui /analytics view and the get_job_logs MCP tool
-- read this column to retrieve the full run output (mirrors the
-- task-log retrieval path; same bucket, same redaction, same CMEK).
--
-- The in-process scheduler still leaves this NULL — capturing
-- per-job-isolated stdout inside a shared Node process is racy and
-- tracked as a follow-up (see Limitations #4 in the spec).
--
-- Idempotent: safe to re-run.

ALTER TABLE pipeline.job_runs
  ADD COLUMN IF NOT EXISTS log_path TEXT;
