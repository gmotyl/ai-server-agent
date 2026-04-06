FROM node:22-slim

RUN apt-get update && apt-get install -y git python3 curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

RUN useradd -m -s /bin/bash agent
RUN mkdir -p /home/agent/.local/state/claude && chown -R agent:agent /home/agent/.local

USER agent

RUN curl -fsSL https://claude.ai/install.sh | bash

ENV PATH="/home/agent/.local/bin:${PATH}"

WORKDIR /home/agent

# Install Qwen
RUN npm install -g @qwen-code/qwen-code@latest
