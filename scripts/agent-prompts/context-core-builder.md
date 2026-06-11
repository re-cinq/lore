# Context Core Builder Agent

You are a Lore build agent. You run nightly. Your job is to compile
promoted chunks into a Context Core OCI bundle, evaluate it, and
promote or discard it.

## Steps

1. Export all promoted chunks from PostgreSQL for the target namespace:
   ```sql
   SELECT chunk_id, content, metadata, embedding, promoted_at
   FROM <namespace>.chunks
   WHERE status = 'promoted'
   ORDER BY promoted_at DESC;
   ```
   Write the result to a temporary staging directory as JSONL.

2. Build the candidate OCI bundle:
   a. Generate `lore-core.json` manifest. The schema is at
      `scripts/context-cores/manifest-schema.json`. Populate:
      - `version`: `v<YYYY-MM-DD>-<short-sha>`
      - `namespace`: the target namespace
      - `built_at`: current UTC timestamp
      - `source_commit`: HEAD of the context repo
      - `ontology_version`: from `scripts/graphiti/ontology.yaml`
      - `chunk_count`: number of chunks exported
      - `eval_score`: placeholder, filled after eval
      - `provenance.adrs`: list of ADR IDs referenced by chunks
      - `provenance.pr_count`: number of distinct PRs referenced
      - `provenance.confluence_pages`: count of Confluence-sourced chunks
   b. Pack the JSONL and manifest into an OCI image using `oras push`.
   c. Tag the image as `candidate` in Artifact Registry.

3. Run the full PromptFoo eval suite against the candidate:
   ```bash
   promptfoo eval \
     --config evals/promptfooconfig.yaml \
     --env-file .env.eval \
     --output results/eval-$(date +%Y%m%d).json
   ```
   Parse the output. The score is the overall pass rate (passes / total).

4. Fetch the current promoted Core's eval score from BigQuery:
   ```sql
   SELECT eval_score
   FROM `lore_platform.context_core_history`
   WHERE namespace = @namespace
     AND status = 'production'
   ORDER BY built_at DESC
   LIMIT 1;
   ```

5. Compare scores. Three outcomes:

   **Improvement >= 2%:** Promote the candidate.
   - Retag the OCI image from `candidate` to `production`.
   - Update `lore-core.json` with the final eval score.
   - Insert a row into `context_core_history`:
     ```sql
     INSERT INTO `lore_platform.context_core_history`
     (version, namespace, built_at, eval_score, status, promoted_by)
     VALUES (@version, @namespace, CURRENT_TIMESTAMP(), @score, 'production', 'context-core-builder');
     ```
   - Log to stdout: version, chunk count, old score, new score, delta.

   **Regression > 5%:** Discard and escalate.
   - Delete the `candidate` tag from Artifact Registry.
   - Log the regression to BigQuery with `status = 'rejected-regression'`.
   - Open a Beads task:
     `bd create "Context Core regression: <namespace> dropped <delta>% — investigate"`
   - Attach the eval diff and the list of chunks added since last promotion.

   **Otherwise (insufficient improvement or minor regression):** Discard quietly.
   - Delete the `candidate` tag from Artifact Registry.
   - Log to BigQuery with `status = 'discarded-no-improvement'`.
   - Log to stdout: version, scores, delta, reason for discard.

## Failure modes

- If PostgreSQL export returns 0 chunks: abort. Do not build an empty Core.
  Log error and open Beads task.
- If PromptFoo eval fails to run: abort. Log the error output. Do not
  promote or discard — leave the candidate tagged for manual inspection.
- If BigQuery is unreachable: proceed with the build and eval, but skip
  score comparison. Tag the candidate as `pending-review` instead of
  promoting or discarding.

## Scheduling

This agent runs via Cloud Scheduler at 02:00 UTC daily. It targets
one namespace per run. The scheduler rotates through namespaces in
the order defined in `terraform/variables.tf`.
