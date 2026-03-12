# ============================================================================
# Portlama E2E Test Environment
# ============================================================================
# Docker image based on Ubuntu 24.04 with systemd support for running
# end-to-end tests in an isolated environment.
#
# Limitations:
# - Let's Encrypt tests require real DNS and cannot run inside Docker
# - systemd inside Docker requires --privileged or specific capabilities
#
# Build:
#   docker build -t portlama-e2e tests/e2e/docker/
#
# Run (via docker-compose):
#   docker compose -f tests/e2e/docker/docker-compose.yml up
# ============================================================================

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV container=docker

# Install systemd and remove unnecessary units
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      systemd \
      systemd-sysv \
      dbus \
    && rm -f /lib/systemd/system/multi-user.target.wants/* \
    && rm -f /etc/systemd/system/*.wants/* \
    && rm -f /lib/systemd/system/local-fs.target.wants/* \
    && rm -f /lib/systemd/system/sockets.target.wants/*udev* \
    && rm -f /lib/systemd/system/sockets.target.wants/*initctl* \
    && rm -f /lib/systemd/system/basic.target.wants/* \
    && rm -f /lib/systemd/system/anaconda.target.wants/*

# Install test dependencies
RUN apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
      jq \
      openssl \
      nginx \
      sudo \
      iproute2 \
      gnupg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create portlama user (matches production setup)
RUN useradd -r -m -s /bin/bash portlama

# Create directory structure matching production
RUN mkdir -p /etc/portlama/pki \
             /opt/portlama \
             /var/log/portlama

# Working directory for the project
WORKDIR /opt/portlama/project

# Copy project files (when using docker build with context at repo root)
# When using docker-compose, we mount the project directory instead.

# Expose the panel port
EXPOSE 9292

# Use systemd as init
STOPSIGNAL SIGRTMIN+3

VOLUME ["/sys/fs/cgroup"]

CMD ["/lib/systemd/systemd"]
