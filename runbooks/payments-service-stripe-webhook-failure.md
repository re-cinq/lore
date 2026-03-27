---
service: payments-service
incident_type: stripe-webhook-failure
severity: P1
trigger: "Alert: webhook_processing_error_rate > 5%"
last_incident: 2025-07-22
last_updated: 2025-07-23
---

# Stripe Webhook Failure

## Symptoms

- Stripe dashboard (https://dashboard.stripe.com/webhooks) shows events pending or failed — not acknowledged.
- Logs show 400 or 500 responses on `POST /webhooks/stripe`.
- Customers report charges going through but not reflected in the app (subscriptions stuck, invoices not generated).
- Datadog alert: `webhook_processing_error_rate > 5%` firing.

## Diagnosis and Resolution

### 1. Check webhook signature validation

```bash
kubectl logs -l app=payments-service --since=15m | grep "webhook signature mismatch"
```

If you see `webhook signature mismatch` errors, the `STRIPE_WEBHOOK_SECRET` has rotated on Stripe's side (or someone changed it in the Stripe dashboard without updating our side).

**Fix:**

Go to Stripe dashboard > Developers > Webhooks > select the endpoint > reveal signing secret. Then:

```bash
kubectl set env deploy/payments-service STRIPE_WEBHOOK_SECRET=whsec_NEW_SECRET_HERE
```

This triggers a rolling restart. Watch the rollout:

```bash
kubectl rollout status deploy/payments-service
```

Verify errors stop:

```bash
kubectl logs -l app=payments-service --since=2m | grep -c "webhook signature mismatch"
```

Should return 0.

### 2. Check idempotency store (Redis)

Webhooks fail at the dedup check if Redis is unreachable. Check Redis health:

```bash
kubectl exec redis-0 -- redis-cli ping
```

Expected response: `PONG`. If it hangs or returns an error:

```bash
kubectl describe pod redis-0
kubectl logs redis-0 --tail=50
```

Common causes:
- Redis OOM — check `used_memory` vs `maxmemory`: `kubectl exec redis-0 -- redis-cli info memory`
- Redis pod evicted — check node resource pressure: `kubectl describe node $(kubectl get pod redis-0 -o jsonpath='{.spec.nodeName}')`

If Redis is down and cannot be recovered quickly, you can temporarily bypass dedup by setting:

```bash
kubectl set env deploy/payments-service WEBHOOK_DEDUP_ENABLED=false
```

**Do not leave this off.** Stripe retries aggressively. Re-enable as soon as Redis is back.

### 3. Replay backlog

Once the root cause is fixed, check the backlog in Stripe:

```bash
stripe events list --limit 20 --delivery-success=false
```

If there are more than 1000 undelivered events, replay in batches:

```bash
stripe events resend --limit 100
```

Repeat until the backlog clears. Monitor the payments-service logs during replay to make sure processing keeps up.

For targeted replay of a specific event type (e.g., only invoice events):

```bash
stripe events list --type=invoice.payment_succeeded --delivery-success=false --limit 50
```

### 4. Verify resolution

- Stripe dashboard shows events acknowledged (green checkmarks).
- `webhook_processing_error_rate` drops below threshold.
- No new 400/500 errors in logs.

## Post-Incident

- Update `last_incident` and `last_updated` dates in this file's frontmatter.
- Add any new symptoms or failure modes discovered during the incident.
- If the root cause was a secret rotation, file a ticket to add secret rotation alerting.
- If Redis was the cause, review Redis monitoring and capacity.
