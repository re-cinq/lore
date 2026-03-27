# Platform Team

## API Gateway

Kong-based API gateway, deployed on GKE as a Deployment with 3 replicas (prod). All external traffic routes through here before hitting backend services.

**Rate limiting:** Default is 1000 requests/minute per API key. Configured per-route in `kong/rate-limits.yaml`. Some endpoints have lower limits (e.g., `/auth/login` is 20/min to limit brute force). Rate limit headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in every response.

**JWT validation:** Kong validates JWTs at the gateway using the Auth0 JWKS endpoint. Invalid or expired tokens get a `401` before the request reaches any backend service. The gateway extracts user claims and forwards them as gRPC metadata to downstream services.

**Routing:** Route configuration lives in `kong/routes.yaml`. New routes need a PR reviewed by platform team. Don't add routes directly through Kong's admin API — it gets overwritten on deploy.

## Service Mesh

Istio handles mTLS between all services in the cluster. Every service-to-service call is encrypted and authenticated at the transport layer. No service can bypass the mesh — Istio's `PeerAuthentication` policy is set to `STRICT` mode cluster-wide.

Sidecar injection is automatic for all namespaces except `kube-system` and `monitoring`.

If you're adding a new service, it gets a sidecar automatically. You'll need an `AuthorizationPolicy` to define which other services can call it — see `istio/authz-policies/` for examples.

## CI/CD

All services use GitHub Actions for CI/CD. The workflow files live in each service's repo under `.github/workflows/`.

**Build:** On every PR — lint, test, build Docker image, push to Artifact Registry.

**Staging:** Merging to `main` triggers auto-deploy to the `staging` GKE cluster via Helm. No manual step.

**Production:** After staging deploy, a manual approval step in GitHub Actions is required. At least one platform team member must approve. Deploy goes through Helm to the `prod` GKE cluster with a rolling update strategy (25% max unavailable).

Helm charts are in `deploy/charts/` in each service repo. Shared chart templates are in the `helm-charts` repo.

Rollback: `make rollback SERVICE=<name>` in the `platform-ops` repo. This runs `helm rollback` to the previous release.

## Monitoring

**Metrics:** Datadog agents run as a DaemonSet on every node. Services emit custom metrics via the Datadog Go client (`pkg/metrics`). Standard dashboards exist for every service: request rate, error rate, latency (p50/p95/p99), pod resource usage.

**Alerting:** PagerDuty, integrated with Datadog monitors. On-call rotation is weekly, managed in PagerDuty. Escalation policy: page on-call engineer -> wait 10 min -> page team lead -> wait 10 min -> page engineering manager.

**SLOs:** Customer-facing services target 99.9% availability (measured monthly, based on successful HTTP responses). SLO dashboards in Datadog under "Platform SLOs". If we're burning error budget too fast, we freeze feature deploys until we stabilize.

## Current Work

**OpenTelemetry rollout.** We're replacing our ad-hoc tracing (mix of Datadog APM and manual spans) with OpenTelemetry across all services. The Go SDK is integrated into `pkg/telemetry`. Services need to swap their tracing imports to use the new package.

Status: `platform-api` and `identity-service` are instrumented. `payments-service` is next. Target is full coverage by end of Q1.

Traces export to Datadog via the OpenTelemetry Collector running as a sidecar.
