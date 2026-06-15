FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/@google-cloud ./node_modules/@google-cloud
COPY --from=builder /app/node_modules/octokit ./node_modules/octokit
COPY --from=builder /app/node_modules/@octokit ./node_modules/@octokit
EXPOSE 3000
CMD ["node", "server.js"]
