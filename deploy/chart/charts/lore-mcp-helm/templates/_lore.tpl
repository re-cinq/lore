{{- /*
The same file sits in every Lore subchart (scripts/check-lore-platform-render.sh
fails when the copies differ), so each one still renders on its own.
*/ -}}

{{- define "lore.scheduling" -}}
{{- $global := .Values.global | default dict -}}
{{- with .Values.nodeSelector | default $global.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations | default $global.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- /*
Identity and bookkeeping for a pod, as plain labels and annotations: the chart's
own podLabels / podAnnotations over global.podLabels / global.podAnnotations.
Whatever a cluster binds a workload identity with (a label on the pod, an
annotation on the ServiceAccount) is a value; nothing here knows a cloud.
*/ -}}
{{- define "lore.podLabels" -}}
{{- $global := .Values.global | default dict -}}
{{- with merge (dict) (.Values.podLabels | default dict) ($global.podLabels | default dict) }}
{{- toYaml . }}
{{- end }}
{{- end -}}

{{- define "lore.podAnnotations" -}}
{{- $global := .Values.global | default dict -}}
{{- with merge (dict) (.Values.podAnnotations | default dict) ($global.podAnnotations | default dict) }}
{{- toYaml . }}
{{- end }}
{{- end -}}

{{- define "lore.podSettings" -}}
{{- include "lore.scheduling" . }}
{{- if .Values.hardened }}
securityContext:
  runAsNonRoot: true
  runAsUser: {{ .Values.runAsUser | default 1000 }}
  runAsGroup: {{ .Values.runAsUser | default 1000 }}
  seccompProfile:
    type: RuntimeDefault
{{- end }}
{{- end -}}

{{- define "lore.containerSecurityContext" -}}
{{- if .Values.hardened }}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
{{- end }}
{{- end -}}

{{- define "lore.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag }}{{ with .Values.image.digest }}@{{ . }}{{ end }}
{{- end -}}
