{{/*
In-cluster addresses in values.yaml are derived from the release name and
namespace, so both are fixed.
*/}}
{{- define "lore-install.checks" -}}
{{- if or (ne .Release.Name "lore") (ne .Release.Namespace "lore-floor") -}}
{{- fail "install as: helm upgrade --install lore deploy/install -n lore-floor --create-namespace -f <values>" -}}
{{- end -}}
{{- end -}}

{{/*
One Secret. A hook, so it exists before the floor's and Lore's own pre-install
jobs read it.
Takes: namespace, name, data (a map of plain strings), and optionally type.
*/}}
{{- define "lore-install.secret" -}}
---
apiVersion: v1
kind: Secret
metadata:
  name: {{ .name }}
  namespace: {{ .namespace }}
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-20"
    helm.sh/resource-policy: keep
type: {{ .type | default "Opaque" }}
stringData:
  {{- range $key, $value := .data }}
  {{ $key }}: {{ $value | toString | quote }}
  {{- end }}
{{- end -}}

{{- define "lore-install.dockerconfigjson" -}}
{{- $auth := printf "%s:%s" .username .token | b64enc -}}
{{- dict "auths" (dict "ghcr.io" (dict "username" .username "password" .token "auth" $auth)) | toJson -}}
{{- end -}}
