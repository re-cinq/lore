{{/*
In-cluster addresses in values.yaml are derived from the release name and
namespace, so both are fixed.
*/}}
{{- define "lore-install.checks" -}}
{{- if or (ne .Release.Name "lore") (ne .Release.Namespace "lore-floor") -}}
{{- fail "install as: helm upgrade --install lore deploy/install -n lore-floor --create-namespace -f <values>" -}}
{{- end -}}
{{- include "lore-install.noPlaceholders" (dict "path" "" "values" .Values) -}}
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

{{/*
One secret value. Takes: setting (the values key, for messages), provided (what
the installer set), namespace, name and key (where an earlier install left it),
generate (true: make one when nothing else gives it), length (of a generated
one) and hex (true: generate 64 hexadecimal characters, 32 bytes) and minLength.
In order: the installer's value; the value already in the cluster, so a rotation
done outside Helm survives an upgrade; a generated one; else the install stops.
*/}}
{{- define "lore-install.value" -}}
{{- if .provided -}}
{{- if lt (len .provided) (int (.minLength | default 0)) -}}
{{- fail (printf "%s is %d characters; it must be at least %d (openssl rand -hex 32)" .setting (len .provided) (int .minLength)) -}}
{{- end -}}
{{- .provided -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .namespace .name -}}
{{- if and $existing $existing.data (hasKey $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else if and .generate .hex -}}
{{- sha256sum (randAlphaNum 48) -}}
{{- else if .generate -}}
{{- randAlphaNum (int (.length | default 48)) -}}
{{- else -}}
{{- fail (printf "%s is required" .setting) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Fails when any value of the release still holds a CHANGE-ME placeholder. Takes: path and values. */}}
{{- define "lore-install.noPlaceholders" -}}
{{- $path := .path -}}
{{- range $key, $value := .values -}}
{{- if kindIs "map" $value -}}
{{- include "lore-install.noPlaceholders" (dict "path" (printf "%s%s." $path $key) "values" $value) -}}
{{- else if and (kindIs "string" $value) (contains "CHANGE-ME" $value) -}}
{{- fail (printf "%s%s still holds the placeholder CHANGE-ME" $path $key) -}}
{{- end -}}
{{- end -}}
{{- end -}}
