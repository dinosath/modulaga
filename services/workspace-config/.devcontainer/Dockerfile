FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Install mise runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libssl-dev \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install mise from official installer
RUN curl https://mise.jdx.dev/install.sh | sh && \
    mv ~/.local/bin/mise /usr/local/bin/mise

# Ensure mise is available in PATH
ENV PATH="/home/vscode/.local/bin:$PATH"
