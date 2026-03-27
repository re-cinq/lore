# Data Team

## Pipeline Architecture

Event processing pipelines run on Apache Beam, deployed to Google Cloud Dataflow. Pipelines read from Pub/Sub topics, apply transformations, and write to BigQuery.

Each pipeline has a corresponding job definition in `data-pipelines/jobs/`. Pipeline code is Java (Beam Java SDK). We chose Java over Python here because the Java runner has better autoscaling behavior on Dataflow for our throughput levels.

Standard pipeline pattern:
1. Read from Pub/Sub subscription
2. Deserialize Protobuf event
3. Validate and enrich (e.g., resolve user IDs to org IDs)
4. Write to BigQuery (streaming inserts for real-time, batch loads for backfills)

Pipelines are deployed via Terraform in `terraform/dataflow/`. Each pipeline has its own Terraform module.

## Data Warehouse

BigQuery is the warehouse. Datasets are organized by domain:
- `payments` — charges, refunds, disputes, settlement data
- `identity` — users, organizations, roles, login events
- `product` — feature usage, session events, funnel data
- `finance` — revenue recognition, MRR calculations (derived from payments + identity)

**Transformations:** dbt runs on a schedule (every 6 hours for most models, hourly for revenue metrics). dbt project is in the `lore-dbt` repo. Models follow the staging -> intermediate -> marts pattern. All marts have tests and documentation.

**Raw vs. transformed:** Raw event data lands in `*_raw` datasets (e.g., `payments_raw`). dbt transforms it into the clean datasets listed above. Analysts should query the clean datasets, not raw.

## Schema Registry

All event schemas are Protobuf definitions in the `proto-schemas` repo. Every service that publishes or consumes events depends on this repo.

**Breaking changes** (removing a field, changing a field type, renaming a field) require an ADR and a migration plan. Non-breaking changes (adding optional fields) can go through normal PR review.

CI checks in `proto-schemas` run `buf breaking` against the previous version to catch accidental breaking changes.

## Data Access

**Business users:** Looker dashboards, organized by domain (Payments, Growth, Product). Dashboard requests go through the data team — file a ticket in Linear under the `data-dashboards` project.

**Analysts:** Direct BigQuery access via the console or connected BI tools. Access is read-only. Row-level security is enforced through BigQuery authorized views — analysts can only see data for their assigned organizations.

**Engineers:** For debugging, you can query BigQuery directly. Use the `engineering` IAM role, which has read access to all datasets. Don't run expensive queries during business hours — BigQuery charges by bytes scanned.

## Current Work

**Payment fraud anomaly detection.** We're building a real-time pipeline that scores transactions for fraud signals. It reads from the `payment.created` Pub/Sub topic, runs the transaction through a scoring model (feature extraction in Beam, model inference via a Vertex AI endpoint), and writes scores to a `fraud_scores` BigQuery table.

The scoring result is also published to a `fraud.score_computed` Pub/Sub topic so `payments-service` can act on high-risk scores (hold for review, block, etc.).

Status: feature extraction pipeline is in staging. Model is trained and deployed to Vertex AI. Integration with `payments-service` for automated holds is not started yet — targeting next sprint.
