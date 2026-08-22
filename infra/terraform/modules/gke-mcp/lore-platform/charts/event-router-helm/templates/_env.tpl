{{/*
Shared environment block for the lore-event-router Deployment.

Usage:
  env:
    {{- include "lore-event-router.env" . | nindent 12 }}
*/}}
{{- define "lore-event-router.env" -}}
{{- range $key, $val := .Values.env }}
- name: {{ $key }}
  value: {{ $val | quote }}
{{- end }}
- name: LORE_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.dbPasswordSecret.name }}
      key: {{ .Values.dbPasswordSecret.key }}
- name: LORE_WEBHOOK_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.webhookSecret.name }}
      key: {{ .Values.webhookSecret.key }}
- name: LORE_INGEST_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.ingestTokenSecret.name }}
      key: {{ .Values.ingestTokenSecret.key }}
{{- end -}}
