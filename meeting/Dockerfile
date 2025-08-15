# Use Node.js base image
FROM node:22-bookworm

# Switch to root to install dependencies
USER root

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-venv python3-pip \
    curl \
    ffmpeg \
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

# Copy Python requirements first for better docker layer caching
COPY --chown=pulseuser:pulseuser py/requirements.txt ./py/requirements.txt

# Create venv and install Python deps
RUN python3 -m venv /home/pulseuser/venv && \
    . /home/pulseuser/venv/bin/activate && \
    pip install --no-cache-dir -r py/requirements.txt

# Copy the rest of the Python code
COPY --chown=pulseuser:pulseuser py ./py

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
