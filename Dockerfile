FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/rateio.sqlite
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.ts ./
COPY drizzle ./drizzle
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
CMD ["bun", "server.ts"]
