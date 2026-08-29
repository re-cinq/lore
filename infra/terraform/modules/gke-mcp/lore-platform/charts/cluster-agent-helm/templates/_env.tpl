{{/*
Shared environment block for the lore-cluster-agent Deployment.

Note what is ABSENT: no database credentials. This service holds no pool — it
performs cluster operations for callers who bring their own state.

Usage:
  env:
    {{- include "lore-cluster-agent.env" . | nindent 12 }}
*/}}
{{- define "lore-cluster-agent.env" -}}
{{- range $key, $val := .Values.env }}
- name: {{ $key }}
  value: {{ $val | quote }}
{{- end }}
{{- if .Values.podLogStreaming }}
# Off by default: this is the input that puts log VOLUME on pipeline.events.
- name: LORE_POD_LOG_STREAMING
  value: "1"
{{- end }}
- name: LORE_AGENTS_NAMESPACE
  value: {{ .Values.agentsNamespace | quote }}
- name: LORE_INGEST_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.ingestTokenSecret.name }}
      key: {{ .Values.ingestTokenSecret.key }}
- name: GITHUB_APP_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.githubAppSecret.name }}
      key: {{ .Values.githubAppSecret.appIdKey }}
- name: GITHUB_APP_PRIVATE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.githubAppSecret.name }}
      key: {{ .Values.githubAppSecret.privateKeyKey }}
- name: GITHUB_APP_INSTALLATION_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.githubAppSecret.name }}
      key: {{ .Values.githubAppSecret.installationIdKey }}
# Registration + claim + heartbeat against the in-cluster lore-api, identity
# persisted via the Kubernetes Secret API (FR3). NOT optional and not a flag:
# dispatch is pull-only, so an agent that cannot register claims nothing and
# every queued run in this cluster dies at the queue-wait bound. The process
# refuses to boot without these three, which is the loud version of that.
- name: LORE_API_URL
  value: {{ .Values.claim.loreApiUrl | quote }}
- name: LORE_CLUSTER_AGENT_NAME
  value: {{ .Values.claim.name | quote }}
- name: LORE_CLUSTER_AGENT_TAGS
  value: {{ .Values.claim.tags | quote }}
- name: LORE_CLUSTER_AGENT_IDENTITY_SECRET
  value: {{ .Values.claim.identitySecretName | quote }}
- name: LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE
  value: {{ .Values.namespace | quote }}
- name: LORE_CLUSTER_AGENT_REGISTRATION_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.claim.registrationTokenSecret.name }}
      key: {{ .Values.claim.registrationTokenSecret.key }}
{{- end -}}
