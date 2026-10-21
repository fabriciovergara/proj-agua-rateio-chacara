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
# Writable by the unprivileged user; a new named volume mounted here starts
# with this ownership.
RUN mkdir data && chown bun:bun data
USER bun
EXPOSE 3000
CMD ["bun", "server.ts"]
