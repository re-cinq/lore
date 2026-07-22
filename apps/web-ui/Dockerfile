FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# Git SHA of the deployed commit — surfaced at runtime via /api/version and the
# sidebar version label so "is my merge live?" is answerable without spelunking
# the cluster. Defaults to "dev" for local builds.
ARG GIT_SHA=dev
ENV LORE_UI_VERSION=$GIT_SHA
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=dev
ENV LORE_UI_VERSION=$GIT_SHA
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/@google-cloud ./node_modules/@google-cloud
COPY --from=builder /app/node_modules/octokit ./node_modules/octokit
COPY --from=builder /app/node_modules/@octokit ./node_modules/@octokit
EXPOSE 3000
CMD ["node", "server.js"]
