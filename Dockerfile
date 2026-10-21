# Production image: the Bun server (server.ts) on port 3000.
#
#   docker build -t rateio .
#   docker run -p 3000:3000 -v rateio-data:/app/data rateio
#
# The SQLite database lives in /app/data. Mount a volume there, or it is lost
# every time the container is replaced (every deploy).

FROM oven/bun:1.4-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# The server bundle imports its dependencies from node_modules at runtime:
# install them without the build tooling.
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY package.json server.ts ./
COPY drizzle drizzle
RUN mkdir data
EXPOSE 3000
# The server runs as the unprivileged bun user, but the container starts as
# root to first give it /app/data. Files written there as root (by an older
# image, a restore, a database copied in by hand) stay root's, and SQLite
# then opens the database read-only: pages load, but unlocking and saving
# fail with "attempt to write a readonly database".
CMD ["sh", "-c", "chown -R bun:bun /app/data && HOME=/home/bun exec setpriv --reuid=bun --regid=bun --init-groups bun server.ts"]
