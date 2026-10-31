# Wavelength Hub. Build from the repo root:  docker build -f hub/Dockerfile -t wavelength-hub .

# The app's web build, which the Hub serves at / so Wavelength works in a browser. Built once on the build
# machine's own platform: the output is plain files, the same for every image platform.
FROM --platform=$BUILDPLATFORM node:25-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npx vite build --outDir /web/dist

FROM node:25-alpine

# su-exec drops from root to PUID/PGID after fixing /data ownership (Unraid uses 99:100).
# python3 + ffmpeg run yt-dlp, which the Hub uses to download into /music. yt-dlp is fetched fresh on
# every image build (YouTube breaks old versions; hub.yml rebuilds weekly) and checked against the release's
# SHA2-256SUMS. It uses Node, already here, for YouTube's player code.
RUN apk add --no-cache su-exec python3 ffmpeg \
 && wget -qO /tmp/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
 && wget -qO /tmp/SHA2-256SUMS https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS \
 && (cd /tmp && grep ' yt-dlp$' SHA2-256SUMS | sha256sum -c -) \
 && install -m 755 /tmp/yt-dlp /usr/local/bin/yt-dlp && rm /tmp/yt-dlp /tmp/SHA2-256SUMS \
 && printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf \
 && yt-dlp --version
WORKDIR /app
COPY hub/package.json hub/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY hub/src ./src
COPY --from=web /web/dist ./web
COPY hub/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=7780 \
    WAVELENGTH_DATA_DIR=/data \
    WAVELENGTH_MUSIC_DIR=/music \
    PUID=1000 \
    PGID=1000
VOLUME /data
EXPOSE 7780
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
