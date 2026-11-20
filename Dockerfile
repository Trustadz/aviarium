FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/game-sdk/package.json packages/game-sdk/
COPY packages/sudoku/package.json packages/sudoku/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY package.json ./
RUN install -d -m 0700 -o node -g node /backup
USER node
EXPOSE 4173
CMD ["node", "dist/apps/server/src/app.js"]
