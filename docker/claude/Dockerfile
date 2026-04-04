FROM node:22-slim

RUN apt-get update && apt-get install -y \
    bash curl git jq python3 wkhtmltopdf \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

RUN curl -fsSL https://claude.ai/install.sh | bash \
    && mkdir -p .local/state/claude
