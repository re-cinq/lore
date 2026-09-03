# Spend guardrail for the project: a Cloud Billing budget with alert thresholds.
#
# The budget is stated per WEEK because that is how the team reasons about it,
# but Cloud Billing budgets only reset on calendar months, so the amount Google
# sees is the monthly equivalent (weekly * 52 / 12). The forecasted-spend rule
# is what makes the weekly figure bite: it fires as soon as the month's run
# rate is on course to exceed the amount, i.e. as soon as spend exceeds the
# weekly pace, without waiting for the money to be gone.
#
# This is an ALERT, not a cap. Google Cloud has no native spend ceiling; the
# only hard stop is a Pub/Sub-driven function that detaches billing, which
# tears down the whole cluster mid-run. That is deliberately not wired here.
#
# The budget is scoped to this project only: the billing account it hangs off
# is shared with other workloads, and an unscoped budget would count them too.
#
# Applying needs Billing Account Costs Manager on the billing account, a role
# that project-level Owner/Editor does NOT include.

variable "enable_gcp_budget" {
  description = "Create the Cloud Billing budget + threshold alerts for this project. Applying needs Billing Account Costs Manager on the project's billing account."
  type        = bool
  default     = false
}

variable "gcp_budget_weekly_usd" {
  description = "Weekly spend budget in USD. Converted to its monthly equivalent (x52/12) because Cloud Billing budgets reset monthly."
  type        = number
  default     = 1000
}

variable "gcp_billing_account" {
  description = "Billing account ID (e.g. 012345-6789AB-CDEF01) the budget hangs off. Find it with `gcloud billing projects describe <project_id>`."
  type        = string
  default     = ""
}

variable "gcp_budget_alert_emails" {
  description = "Extra email recipients for budget alerts. Billing Account Administrators and Users receive them regardless; this adds addresses that hold neither role."
  type        = list(string)
  default     = []
}

data "google_project" "current" {
  project_id = var.project_id
}

locals {
  gcp_budget_monthly_usd = floor(var.gcp_budget_weekly_usd * 52 / 12)
}

resource "google_monitoring_notification_channel" "budget_email" {
  for_each = var.enable_gcp_budget ? toset(var.gcp_budget_alert_emails) : toset([])

  project      = var.project_id
  display_name = "Lore budget alerts: ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }
}

resource "google_billing_budget" "lore" {
  count = var.enable_gcp_budget ? 1 : 0

  billing_account = var.gcp_billing_account
  display_name    = "lore ${var.project_id}: USD ${var.gcp_budget_weekly_usd}/week"

  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(local.gcp_budget_monthly_usd)
    }
  }

  # Weekly pace exceeded: the month is forecast to blow the amount.
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  # Money actually spent, at roughly one-week strides through the month.
  threshold_rules {
    threshold_percent = 0.25
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.75
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  dynamic "all_updates_rule" {
    for_each = length(var.gcp_budget_alert_emails) > 0 ? [1] : []

    content {
      monitoring_notification_channels = [
        for channel in google_monitoring_notification_channel.budget_email : channel.id
      ]
      disable_default_iam_recipients = false
    }
  }
}
