{{/*
Shared environment block for the lore-stations Deployment.

Usage:
  env:
    {{- include "lore-stations.env" . | nindent 12 }}
*/}}
{{- define "lore-stations.env" -}}
{{- range $key, $val := .Values.env }}
- name: {{ $key }}
  value: {{ $val | quote }}
{{- end }}
- name: LORE_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.dbPasswordSecret.name }}
      key: {{ .Values.dbPasswordSecret.key }}
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
{{- if .Values.anthropicKeySecret }}
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.anthropicKeySecret.name }}
      key: {{ .Values.anthropicKeySecret.key }}
      optional: true
{{- end }}
{{- end -}}
