FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm

# Optional: helpful CLI tools for local debugging inside the container
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Keep image lean; app dependencies are installed via your Docker Compose builds.
