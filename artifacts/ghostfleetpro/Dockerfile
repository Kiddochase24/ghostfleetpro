FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies ───────────────────────────────────────────────────────
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Install tsx and typescript for the server (needed at runtime via tsx)
RUN npm install --save-dev tsx typescript

# ── Build the React frontend ───────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production image ───────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install tsx && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./tsconfig.json

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "--loader", "tsx/esm", "server/index.ts"]
