#!/bin/sh
set -e
# Run as PUID:PGID (Unraid: 99:100 = nobody:users) and make sure the data folder belongs to them.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$WAVELENGTH_DATA_DIR"
  chown -R "$PUID:$PGID" "$WAVELENGTH_DATA_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
