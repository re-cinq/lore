{{/* A cluster's settings: its own values over .Values.defaults. Takes: root and cluster ("lore" or "floor"). */}}
{{- define "lore-databases.cluster" -}}
{{- $own := index .root.Values .cluster -}}
{{- toJson (mergeOverwrite (deepCopy .root.Values.defaults) (deepCopy $own)) -}}
{{- end -}}

{{/* One password: the one already in the cluster, else a generated one. Takes: namespace, name, key. */}}
{{- define "lore-databases.password" -}}
{{- $existing := lookup "v1" "Secret" .namespace .name -}}
{{- if and $existing $existing.data (hasKey $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- randAlphaNum 40 -}}
{{- end -}}
{{- end -}}
