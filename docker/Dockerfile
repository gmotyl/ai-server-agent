# Stage 1: build panel
FROM node:22-slim AS panel-build
WORKDIR /build
COPY panel/package.json panel/package-lock.json ./
RUN npm ci
COPY panel/ .
RUN npm run build

# Stage 2: runtime
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    bash curl git jq python3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

RUN useradd -m -s /bin/bash agent

USER agent
WORKDIR /home/agent

RUN mkdir -p /home/agent/.local/state/claude /home/agent/.npm-global
RUN npm config set prefix /home/agent/.npm-global

ENV PATH="/home/agent/.npm-global/bin:/home/agent/.local/bin:${PATH}"

RUN curl -fsSL https://claude.ai/install.sh | bash
RUN npm install -g @qwen-code/qwen-code@latest

# Copy built panel from stage 1
COPY --from=panel-build --chown=agent:agent /build/dist /home/agent/panel/dist
