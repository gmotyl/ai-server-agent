#!/bin/bash
# DEPRECATED for FOUNDATION1: the agent now runs as a persistent Container Station
# container (docker/docker-compose.yml, restart: unless-stopped) which QNAP auto-
# starts after the volume mounts on boot. Use bin/deploy-container.sh instead.
# News is still soft-cron only (data/schedules.json: generate-news 0 12 * * *).
echo "setup-cron.sh is deprecated. Deploy with: bin/deploy-container.sh"
echo "Reboot persistence is handled by Container Station (restart: unless-stopped)."
exit 0
