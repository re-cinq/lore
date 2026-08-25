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
{{- end -}}
