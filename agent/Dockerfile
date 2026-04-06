FROM node:22-slim AS builder
WORKDIR /app

# Build shared package first
COPY shared/package.json shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm install && npm run build

# Build agent
COPY agent/package.json ./agent/
RUN cd agent && npm install
COPY agent/tsconfig.json ./agent/
COPY agent/src/ ./agent/src/
RUN cd agent && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/agent/dist ./dist
COPY --from=builder /app/agent/node_modules ./node_modules
COPY --from=builder /app/agent/package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
