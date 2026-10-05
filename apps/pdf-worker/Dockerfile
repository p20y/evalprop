# syntax=docker/dockerfile:1
#
# PDF worker image (S10). Deployment is S15; nothing here is deployed by this story.
#
# The build context is the repository root, because the worker imports workspace packages
# (@evalprop/report, @evalprop/shared, and the report/analysis stores from @evalprop/server):
#
#   docker build -f apps/pdf-worker/Dockerfile -t evalprop-pdf-worker .
#
# Node runs the TypeScript sources directly (type stripping), so there is no compile step. The workspace is kept
# in place (not `pnpm deploy`-ed) because Node does not strip types from files under node_modules.

# ---- stage 1: install production dependencies for the worker and the workspace packages it uses ----
FROM node:24-bookworm-slim AS deps
RUN npm install --global pnpm@12.8.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@evalprop/pdf-worker..."

# ---- stage 2: runtime with the distro's Chromium and fonts ----
FROM node:24-bookworm-slim
# Chromium from the distro (security updates with the base image), plus fonts: the report's font stack falls back
# to Helvetica/Arial, which fontconfig maps to Liberation Sans; DejaVu covers symbols.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core fontconfig \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    # Chromium cannot create its sandbox as a non-root user in a default container. The container is the sandbox
    # (Cloud Run gVisor, no capabilities, non-root). Never set this on a developer machine.
    CHROMIUM_NO_SANDBOX=1 \
    PORT=8080

WORKDIR /repo
COPY --from=deps --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/pdf-worker
EXPOSE 8080
CMD ["node", "src/index.ts"]
