#!/bin/bash


# Ensure script runs as non-root user
if [ "$(id -u)" -eq 0 ]; then
    echo "Switching to pulseuser..."
    exec gosu pulseuser "$0" "$@"
fi

# Start virtual display
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
export DISPLAY=:99

# Start DBus 
dbus-daemon --session --address=unix:path=/run/dbus/system_bus_socket &
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
sleep 2  # Ensure DBus initializes

# Ensure the recording directory exists
RECORDINGS_DIR="/home/pulseuser/app/recordings"
mkdir -p "$RECORDINGS_DIR"

echo "Starting API server..."
exec "$@"  # This will now start the API server

# Keep container running
tail -f /dev/null