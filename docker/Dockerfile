FROM node:22-slim

RUN apt-get update && apt-get install -y git python3 curl && rm -rf /var/lib/apt/lists/*

# Install Claude (as root, goes to /usr/local/bin)
RUN npm install -g @anthropic-ai/claude-code

# Install Qwen
RUN npm install -g @qwen-code/qwen-code@latest

WORKDIR /home/agent
