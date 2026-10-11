# The container a floor agent's pod works inside (floor.agentImage in the
# lore-api chart). node:22-bookworm already carries git, curl and sed, which the
# subsystem's git credential helper needs; this layer adds the tools the agent
# prompts and hooks lean on. The subsystem brings its own supervisor.
FROM node:22-bookworm

ARG YQ_VERSION=v4.54.1
ARG YQ_SHA256_AMD64=8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f
ARG YQ_SHA256_ARM64=189088da0c6429ec5178dfaab1a114805f6cab0b61b165ab236efedf1d57a71b
ARG TARGETARCH

RUN set -eu; \
	export DEBIAN_FRONTEND=noninteractive; \
	apt-get update; \
	apt-get install -y --no-install-recommends \
		jq ripgrep python3 make unzip tree file less; \
	rm -rf /var/lib/apt/lists/*

# Debian's yq is the Python wrapper around jq, not mikefarah's yq the pipelines
# are written for: take the pinned, checksum-verified release binary.
RUN set -eu; \
	case "${TARGETARCH}" in \
		amd64) yq_sha256="${YQ_SHA256_AMD64}" ;; \
		arm64) yq_sha256="${YQ_SHA256_ARM64}" ;; \
		*) echo "no pinned yq for ${TARGETARCH}" >&2; exit 1 ;; \
	esac; \
	curl -fsSL -o /usr/local/bin/yq \
		"https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_${TARGETARCH}"; \
	echo "${yq_sha256}  /usr/local/bin/yq" | sha256sum -c -; \
	chmod 0755 /usr/local/bin/yq
