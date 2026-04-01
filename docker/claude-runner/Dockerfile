FROM node:24-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
RUN useradd -m -s /bin/bash runner
RUN mkdir -p /workspace && chown runner:runner /workspace
WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER runner
ENTRYPOINT ["/entrypoint.sh"]
