FROM docker-claude

# Install Qwen (as agent user, already present from base image)
USER agent
WORKDIR /home/agent

ENV PATH="/home/agent/.npm-global/bin:${PATH}"

RUN mkdir -p /home/agent/.npm-global && npm config set prefix '/home/agent/.npm-global'
RUN npm install -g @qwen-code/qwen-code@latest
