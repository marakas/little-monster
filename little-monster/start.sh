#!/usr/bin/env bash
set -euo pipefail

# Start web server in background
bun server.js &

# Start worker in foreground (so the container lifecycle follows this)
exec bun worker.js