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
    BASKETRA_TEMP_DIR=/tmp/basketra \
    OMP_THREAD_LIMIT=1 \
    OMP_NUM_THREADS=1
WORKDIR /app
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa \
    && tesseract --version \
    && tesseract --list-langs | grep -qx spa \
    && printf '%s' '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' | base64 -d > /tmp/basketra-ocr-smoke.png \
    && (ulimit -v 131072; tesseract /tmp/basketra-ocr-smoke.png stdout --oem 1 --psm 6 -l spa 2>/dev/null | grep -q TOTAL) \
    && rm -f /tmp/basketra-ocr-smoke.png
COPY --from=build --chown=node:node /app/dist ./dist
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data /tmp/basketra \
    && chown -R node:node /data /tmp/basketra /app
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readiness').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
