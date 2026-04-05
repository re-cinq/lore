FROM node:24-slim
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code

# Validation CLI — deterministic lint/typecheck before commit
COPY validation/ /tmp/validation/
RUN cd /tmp/validation && npm install --ignore-scripts && npx tsc \
    && cp dist/repo-validation-cli.js /validation.js \
    && cp dist/repo-validation.js /repo-validation.js \
    && rm -rf /tmp/validation

RUN useradd -m -s /bin/bash runner
RUN mkdir -p /workspace && chown runner:runner /workspace
WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER runner
ENTRYPOINT ["/entrypoint.sh"]
