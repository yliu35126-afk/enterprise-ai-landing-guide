FROM node:22.14.0-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY distribution ./distribution
COPY integrations ./integrations
RUN npm run build && npm prune --omit=dev

FROM node:22.14.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3020

WORKDIR /app
RUN groupadd --system landing && useradd --system --gid landing --home-dir /app landing

COPY --from=builder --chown=landing:landing /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=landing:landing /app/node_modules ./node_modules
COPY --from=builder --chown=landing:landing /app/dist ./dist
COPY --from=builder --chown=landing:landing /app/public ./public
COPY --from=builder --chown=landing:landing /app/distribution ./distribution
COPY --from=builder --chown=landing:landing /app/integrations ./integrations
RUN mkdir -p /app/.runtime/uploads && chown -R landing:landing /app/.runtime

USER landing
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3020/api/public/clawhive/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.js"]
