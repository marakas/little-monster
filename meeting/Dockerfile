# Use Node.js base image
FROM node:22-bookworm

# Switch to root to install dependencies
USER root

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    pulseaudio \ 
    xvfb \
    x11-utils \
    dbus-x11 \
    wget \
    unzip \
    curl \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libgtk-3-0 \
    libasound2 \
    libgl1 \
    fonts-liberation \
    chromium \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create a non-root user for security
RUN useradd -m pulseuser && \
    usermod -aG audio pulseuser

# Set up PulseAudio configuration
RUN mkdir -p /home/pulseuser/.config/pulse && \
    chown -R pulseuser:pulseuser /home/pulseuser/.config

# Allow non-root user to access X11
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Configure PulseAudio to run as a normal user
RUN echo "load-module module-null-sink sink_name=ZoomAudio" >> /etc/pulse/default.pa && \
    echo "set-default-sink ZoomAudio" >> /etc/pulse/default.pa && \
    echo "load-module module-loopback source=ZoomAudio.monitor sink=ZoomAudio latency_msec=1" >> /etc/pulse/default.pa && \
    echo "load-module module-native-protocol-unix" >> /etc/pulse/default.pa && \
    echo "exit-idle-time = -1" >> /etc/pulse/daemon.conf && \
    echo "flat-volumes = no" >> /etc/pulse/daemon.conf && \
    echo "disable-shm = false" >> /etc/pulse/client.conf

# Set up DBus with correct permissions
RUN mkdir -p /var/run/dbus && \
    chmod 777 /var/run/dbus && \
    dbus-uuidgen > /var/lib/dbus/machine-id

# Copy and set permissions for entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch back to non-root user for security
USER pulseuser
WORKDIR /home/pulseuser/app

# Copy package.json first
COPY --chown=pulseuser:pulseuser package.json package-lock.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of the project files
COPY --chown=pulseuser:pulseuser . .

# Copy fake media files
COPY --chown=pulseuser:pulseuser media/ /home/pulseuser/app/media/

# Expose the port
EXPOSE 3000

# Use the entrypoint script to start services before running the bot
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "./api_server.ts"]
