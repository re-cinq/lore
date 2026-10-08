# The container a floor agent's pod works inside (floor.agentImage in the
# lore-api chart). node:22-bookworm already carries git, curl and sed, which the
# subsystem's git credential helper needs; this layer adds the tools the agent
# prompts and hooks lean on. The subsystem brings its own supervisor.
FROM node:22-bookworm

ARG YQ_VERSION=v4.54.1
ARG YQ_SHA256=8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f

RUN set -eu; \
	export DEBIAN_FRONTEND=noninteractive; \
	apt-get update; \
	apt-get install -y --no-install-recommends \
		jq ripgrep python3 make unzip tree file less; \
	rm -rf /var/lib/apt/lists/*

# Debian's yq is the Python wrapper around jq, not mikefarah's yq the pipelines
# are written for: take the pinned, checksum-verified release binary.
RUN set -eu; \
	curl -fsSL -o /usr/local/bin/yq \
		"https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64"; \
	echo "${YQ_SHA256}  /usr/local/bin/yq" | sha256sum -c -; \
	chmod 0755 /usr/local/bin/yq
