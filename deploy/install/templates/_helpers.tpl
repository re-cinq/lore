{{/*
In-cluster addresses in values.yaml are derived from the release name and
namespace, so both are fixed.
*/}}
{{- define "lore-install.checks" -}}
{{- if or (ne .Release.Name "lore") (ne .Release.Namespace "lore-floor") -}}
{{- fail "install as: helm upgrade --install lore deploy/install -n lore-floor --create-namespace -f <values>" -}}
{{- end -}}
{{- include "lore-install.noPlaceholders" (dict "path" "" "values" .Values) -}}
{{- if .Values.utopia.enabled -}}
{{- $oidc := (.Values.global | default dict).oidc | default dict -}}
{{- if not $oidc.issuer -}}
{{- fail "global.oidc.issuer is required while utopia.enabled is true (for Microsoft Entra ID: https://login.microsoftonline.com/<tenant id>/v2.0)" -}}
{{- end -}}
{{- if not $oidc.allowedDomains -}}
{{- fail "global.oidc.allowedDomains is required while utopia.enabled is true: the email domains that may sign in" -}}
{{- end -}}
{{- if or (ne (.Values.utopia.oidc.issuer | default "") $oidc.issuer) (ne (.Values.utopia.oidc.allowedDomains | default "") $oidc.allowedDomains) -}}
{{- fail "utopia.oidc.issuer and utopia.oidc.allowedDomains must repeat global.oidc until Utopia reads the shared block" -}}
{{- end -}}
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
  labels:
    lore-install.re-cinq.com/managed: "true"
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

{{/*
The cluster cannot be read: helm template, or helm install --dry-run without
=server. lookup then answers nothing, so a Secret that is not rendered cannot
be told from one that is not there. Prints "true" offline, nothing otherwise.
*/}}
{{- define "lore-install.offline" -}}
{{- if not (lookup "v1" "Namespace" "" "kube-system") -}}true{{- end -}}
{{- end -}}

{{/*
Writes one Secret, or leaves it to whoever made it. Takes everything
lore-install.secret takes, plus:
  setting   the values key of the group, for messages
  inputs    a map of what the installer set for it (key name to value)
  kind      "required": empty inputs mean the Secret is the installer's own, and
            the install stops when it is not there; set inputs must all be set.
            "generated": empty inputs mean a Secret this chart made keeps its
            value, one the installer made is left alone, and an absent one is
            generated.
  offline   the result of lore-install.offline
The Secret this chart writes carries the label lore-install.re-cinq.com/managed.
*/}}
{{- define "lore-install.groupSecret" -}}
{{- $provided := false -}}
{{- $missing := list -}}
{{- range $key, $value := .inputs -}}
{{- if $value -}}{{- $provided = true -}}{{- else -}}{{- $missing = append $missing $key -}}{{- end -}}
{{- end -}}
{{- if and $provided (eq .kind "required") $missing -}}
{{- fail (printf "%s is set only in part: %s are empty" .setting (join ", " (sortAlpha $missing))) -}}
{{- end -}}
{{- $existing := lookup "v1" "Secret" .namespace .name -}}
{{- $write := false -}}
{{- if $provided -}}
{{- $write = true -}}
{{- else if $existing -}}
{{- $write = and (eq .kind "generated") (hasKey ($existing.metadata.labels | default dict) "lore-install.re-cinq.com/managed") -}}
{{- else if eq .kind "generated" -}}
{{- $write = true -}}
{{- else if not .offline -}}
{{- fail (printf "Secret %s/%s does not exist: set %s, or create it yourself with the keys %s" .namespace .name .setting (join ", " (sortAlpha (keys .data)))) -}}
{{- end -}}
{{- if $write }}
{{ include "lore-install.secret" . }}
{{- end -}}
{{- end -}}
