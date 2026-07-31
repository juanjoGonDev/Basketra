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
COPY tests/fixtures/ocr-smoke.png.b64 /tmp/ocr-smoke.png.b64
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-spa \
    && tesseract --version \
    && tesseract --list-langs | grep -qx spa \
    && base64 -d /tmp/ocr-smoke.png.b64 > /tmp/ocr-smoke.png \
    && echo '31a0ad84772e5e2b98db0d5a5ef690154e29479153ee4b38da42f542d5fd9b5d  /tmp/ocr-smoke.png' | sha256sum -c - \
    && (ulimit -v 131072; tesseract /tmp/ocr-smoke.png stdout --oem 1 --psm 6 -l spa | tee /tmp/ocr-smoke.txt) \
    && grep -q TOTAL /tmp/ocr-smoke.txt \
    && rm -f /tmp/ocr-smoke.png /tmp/ocr-smoke.png.b64 /tmp/ocr-smoke.txt
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
