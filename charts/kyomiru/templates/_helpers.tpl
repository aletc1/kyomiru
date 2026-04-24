{{/*
Expand the name of the chart.
*/}}
{{- define "kyomiru.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name (max 63 chars).
*/}}
{{- define "kyomiru.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name + version label value.
*/}}
{{- define "kyomiru.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "kyomiru.labels" -}}
helm.sh/chart: {{ include "kyomiru.chart" . }}
{{ include "kyomiru.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — stable subset used in matchLabels / Service selectors.
*/}}
{{- define "kyomiru.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kyomiru.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "kyomiru.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "kyomiru.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the chart-managed Secret (or the user-supplied existingSecret).
*/}}
{{- define "kyomiru.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "kyomiru.fullname" . }}-secrets
{{- end -}}
{{- end }}

{{/*
Name of the ConfigMap that holds non-sensitive runtime config.
*/}}
{{- define "kyomiru.configmapName" -}}
{{- include "kyomiru.fullname" . }}-config
{{- end }}

{{/*
Resolved web origin. Defaults to https://<host>.
*/}}
{{- define "kyomiru.webOrigin" -}}
{{- printf "https://%s" .Values.host }}
{{- end }}

{{/*
Resolved API origin. Co-hosted with web so the same as webOrigin.
*/}}
{{- define "kyomiru.apiOrigin" -}}
{{- printf "https://%s" .Values.host }}
{{- end }}

{{/*
OIDC redirect URL. Defaults to https://<host>/api/auth/callback.
*/}}
{{- define "kyomiru.oidcRedirectUrl" -}}
{{- if .Values.app.google.redirectUrl -}}
{{- .Values.app.google.redirectUrl -}}
{{- else -}}
{{- printf "https://%s/api/auth/callback" .Values.host -}}
{{- end -}}
{{- end }}

{{/*
DATABASE_URL env block.

- postgresql sub-chart enabled: compose the URL from the Bitnami-generated
  password Secret using k8s $(VAR) substitution, so the password never
  appears in values.yaml or the chart-managed Secret.
- externalDatabase.existingSecret: pull URL from the named Secret.
- externalDatabase.url set: pull URL from the chart-managed Secret.
*/}}
{{- define "kyomiru.databaseEnv" -}}
{{- if .Values.postgresql.enabled -}}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "kyomiru.fullname" . }}-postgresql
      key: password
- name: DATABASE_URL
  value: "postgresql://{{ .Values.postgresql.auth.username }}:$(POSTGRES_PASSWORD)@{{ include "kyomiru.fullname" . }}-postgresql:5432/{{ .Values.postgresql.auth.database }}"
{{- else if .Values.externalDatabase.existingSecret -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalDatabase.existingSecret }}
      key: {{ .Values.externalDatabase.existingSecretKey }}
{{- else if .Values.externalDatabase.url -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "kyomiru.secretName" . }}
      key: DATABASE_URL
{{- else -}}
{{- fail "Either postgresql.enabled=true, externalDatabase.existingSecret, or externalDatabase.url must be configured." -}}
{{- end -}}
{{- end }}

{{/*
REDIS_URL env block.

- redis sub-chart enabled, auth disabled: plain redis:// URL (no credentials).
- redis sub-chart enabled, auth enabled: compose URL with password from Bitnami Secret.
- externalRedis.existingSecret: pull URL from the named Secret.
- externalRedis.url set: pull URL from the chart-managed Secret.
*/}}
{{- define "kyomiru.redisEnv" -}}
{{- if .Values.redis.enabled -}}
  {{- if .Values.redis.auth.enabled -}}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "kyomiru.fullname" . }}-redis
      key: redis-password
- name: REDIS_URL
  value: "redis://:$(REDIS_PASSWORD)@{{ include "kyomiru.fullname" . }}-redis-master:6379"
  {{- else -}}
- name: REDIS_URL
  value: "redis://{{ include "kyomiru.fullname" . }}-redis-master:6379"
  {{- end -}}
{{- else if .Values.externalRedis.existingSecret -}}
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalRedis.existingSecret }}
      key: {{ .Values.externalRedis.existingSecretKey }}
{{- else if .Values.externalRedis.url -}}
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "kyomiru.secretName" . }}
      key: REDIS_URL
{{- else -}}
{{- fail "Either redis.enabled=true, externalRedis.existingSecret, or externalRedis.url must be configured." -}}
{{- end -}}
{{- end }}
