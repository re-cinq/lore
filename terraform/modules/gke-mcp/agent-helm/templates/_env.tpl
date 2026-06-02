{{/*
Shared environment block for the lore-agent Deployment AND every CronJob
spawned by templates/cronjob.yaml. Centralizing here keeps the
in-process scheduler and the K8s CronJob pods on the exact same env,
secrets, and value sources — no drift, no per-target literals.

Usage:
  env:
    {{- include "lore-agent.env" . | nindent 12 }}
*/}}
{{- define "lore-agent.env" -}}
{{- range $key, $val := .Values.env }}
- name: {{ $key }}
  value: {{ $val | quote }}
{{- end }}
- name: LORE_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.dbPasswordSecret.name }}
      key: {{ .Values.dbPasswordSecret.key }}
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.anthropicKeySecret.name }}
      key: {{ .Values.anthropicKeySecret.key }}
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
- name: LORE_INGEST_TOKEN
  valueFrom:
    secretKeyRef:
      name: lore-ingest-token
      key: token
      optional: true
- name: LORE_AGENT_INTERNAL_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.internalTokenSecret.name }}
      key: {{ .Values.internalTokenSecret.key }}
{{- if .Values.slackBotTokenSecret }}
- name: LORE_SLACK_BOT_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.slackBotTokenSecret.name }}
      key: {{ .Values.slackBotTokenSecret.key }}
      optional: true
{{- end }}
{{- end -}}
