FROM node:22-slim

RUN apt-get update && apt-get install -y \
    bash curl git jq python3 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install AI CLIs
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN npm install -g @qwen-code/qwen-code@latest

# Create user and configure home
RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

RUN mkdir -p .local/state/claude
