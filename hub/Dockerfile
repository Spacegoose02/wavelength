# Wavelength Hub. Build from the repo root:  docker build -t wavelength-hub hub
FROM node:22-alpine

# su-exec drops from root to PUID/PGID after fixing /data ownership (Unraid uses 99:100).
# python3 + ffmpeg run yt-dlp, which the Hub uses to download into /music. yt-dlp is fetched fresh on
# every image build (YouTube breaks old versions); it uses Node, already here, for YouTube's player code.
RUN apk add --no-cache su-exec python3 ffmpeg \
 && wget -qO /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp \
 && printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf \
 && yt-dlp --version
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/
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
