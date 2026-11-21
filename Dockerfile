FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/game-sdk/package.json packages/game-sdk/
COPY packages/sudoku/package.json packages/sudoku/
RUN npm ci
COPY . .
ARG AVIARIUM_RELEASE_VERSION
RUN if [ -n "$AVIARIUM_RELEASE_VERSION" ]; then npm version "$AVIARIUM_RELEASE_VERSION" --no-git-tag-version --ignore-scripts --allow-same-version; fi
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client ca-certificates gosu && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY --from=build /app/package.json ./
RUN install -d -m 0700 -o node -g node /backup
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/aviarium-entrypoint
ENTRYPOINT ["/usr/local/bin/aviarium-entrypoint"]
EXPOSE 4173
CMD ["node", "dist/apps/server/src/app.js"]
