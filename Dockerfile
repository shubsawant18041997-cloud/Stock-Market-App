# Stock Tracker API server. Works on Railway, Fly.io, Render or any Docker host.
# Mount a persistent volume at /data so profiles, watchlists and alerts survive redeploys.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_FILE=/data/db.json

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/src ./src
COPY server/scripts ./scripts

RUN mkdir -p /data
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "src/index.js"]
