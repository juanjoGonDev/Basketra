# syntax=docker/dockerfile:1.7
FROM node:22.23.1-alpine3.24 AS build
WORKDIR /app
RUN npm install --global --ignore-scripts typescript@5.8.3
COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN tsc --noEmit && tsc -p tsconfig.build.json \
    && cp -R src/web dist/web \
    && cp package.json dist/package.json

FROM node:22.23.1-alpine3.24 AS runtime
ENV NODE_ENV=production \
    BASKETRA_HOST=0.0.0.0 \
    BASKETRA_PORT=3000 \
    BASKETRA_DATA_DIR=/data \
    BASKETRA_TEMP_DIR=/tmp/basketra
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data /tmp/basketra \
    && chown -R node:node /data /tmp/basketra /app
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
