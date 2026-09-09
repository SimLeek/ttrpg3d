# Build context is the REPO ROOT, not this package -- pnpm workspace
# resolution needs pnpm-workspace.yaml and every package's package.json to
# link @ttrpg3d/shared correctly. Build with:
#   docker build -f packages/server/Dockerfile -t ttrpg3d-server .
#
# No compile/dist step -- the server runs its real TypeScript source
# directly via tsx (a real dependency, not just a dev tool) both in dev and
# here, matching how it already runs locally. See packages/server's
# package.json "start" script.

FROM node:26-alpine AS deps
WORKDIR /app
# corepack is no longer bundled in the node:26 images (removed from Node
# core) -- install the exact pinned pnpm version directly instead.
RUN npm install -g pnpm@11.3.0

# Copy just the manifests first so `pnpm install` is its own cached layer,
# independent of source-code changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --frozen-lockfile

FROM node:26-alpine AS runtime
WORKDIR /app
RUN npm install -g pnpm@11.3.0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server

ENV NODE_ENV=production
EXPOSE 2567
CMD ["pnpm", "--filter", "@ttrpg3d/server", "start"]
