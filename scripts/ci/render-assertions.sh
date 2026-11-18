# Sourced by the chart check scripts. Assertions on rendered Kubernetes YAML:
# the rendered text is the first argument, the rest is jq over one object per
# workload with .kind, .name, .namespace and .pod (its pod spec).

render_failed=0

render_objects() {
  yq -o=json -I=0 '.' <<<"$1" | jq -c 'select(.kind?)'
}

render_workloads() {
  render_objects "$1" | jq -c '
    select(.kind == "Deployment" or .kind == "StatefulSet" or .kind == "Job" or .kind == "CronJob")
    | {kind, name: .metadata.name, namespace: (.metadata.namespace // ""),
       pod: (.spec.template // .spec.jobTemplate.spec.template).spec}'
}

render_ok() { echo "  ok: $1"; }
render_fail() { echo "  FAILED: $1" >&2; render_failed=1; }

# every_workload <rendered> <description> <jq condition on one workload> [namespace regex]
every_workload() {
  local rendered="$1" description="$2" condition="$3" namespaces="${4:-.*}" total offenders
  total="$(render_workloads "$rendered" | jq -c --arg ns "$namespaces" 'select(.namespace | test($ns))' | wc -l)"
  [[ "$total" -gt 0 ]] || { render_fail "$description (no workload in namespaces ${namespaces})"; return; }
  offenders="$(render_workloads "$rendered" | jq -r --arg ns "$namespaces" \
    "select(.namespace | test(\$ns)) | select(($condition) | not) | \"\(.kind)/\(.namespace)/\(.name)\"")"
  if [[ -z "$offenders" ]]; then
    render_ok "$description ($total workloads)"
  else
    render_fail "$description: $(paste -sd' ' <<<"$offenders")"
  fi
}

# service_accounts_exist <rendered> <namespace regex>: every ServiceAccount a workload names is rendered
service_accounts_exist() {
  local missing
  missing="$(comm -23 \
    <(render_workloads "$1" | jq -r --arg ns "$2" 'select(.namespace | test($ns)) | [.namespace, (.pod.serviceAccountName // "default")] | join("/")' | sort -u) \
    <(render_objects "$1" | jq -r 'select(.kind == "ServiceAccount") | [.metadata.namespace, .metadata.name] | join("/")' | sort -u) \
    | grep -v '/default$' || true)"
  if [[ -z "$missing" ]]; then
    render_ok "every ServiceAccount a workload names is rendered"
  else
    render_fail "workloads name ServiceAccounts that are not rendered: $(paste -sd' ' <<<"$missing")"
  fi
}

# rendered_has <rendered> <description> <jq condition on one object>
rendered_has() {
  if render_objects "$1" | jq -e -n "[inputs | select($3)] | length > 0" >/dev/null; then
    render_ok "$2"
  else
    render_fail "$2"
  fi
}

# rendered_count <rendered> <description> <jq condition on one object> <expected number of objects>
rendered_count() {
  local count
  count="$(render_objects "$1" | jq -c "select($3)" | wc -l)"
  if [[ "$count" -eq "$4" ]]; then
    render_ok "$2 ($count)"
  else
    render_fail "$2: expected $4, found $count"
  fi
}

# rendered_lacks <rendered> <description> <jq condition on one object>
rendered_lacks() {
  local found
  found="$(render_objects "$1" | jq -r "select($3) | \"\(.kind)/\(.metadata.namespace // \"\")/\(.metadata.name)\"")"
  if [[ -z "$found" ]]; then
    render_ok "$2"
  else
    render_fail "$2: $(paste -sd' ' <<<"$found")"
  fi
}

# rendered_text_lacks <rendered> <description> <fixed string>
rendered_text_lacks() {
  if grep -qF -- "$3" <<<"$1"; then
    render_fail "$2 (found '$3')"
  else
    render_ok "$2"
  fi
}

finish_assertions() {
  [[ "$render_failed" -eq 0 ]] || { echo "$1 FAILED" >&2; exit 1; }
}
