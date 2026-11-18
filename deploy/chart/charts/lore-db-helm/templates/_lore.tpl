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
