import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Paths the Hub itself answers; everything else under / is the app. */
const HUB_PATHS = /^\/(api|auth|setup|link)(\/|$|\?)/;

/**
 * The app's web build at /, so people can use Wavelength in a browser (docs/HUB.md "In a browser").
 * Files come from `webDir`; any other path gets index.html, since the app routes on its own.
 */
export function webRoutes(app: FastifyInstance, webDir: string) {
  const root = webDir && existsSync(join(webDir, 'index.html')) ? normalize(webDir) : '';
  if (!root) {
    app.get('/', async (_req, reply) => reply.redirect('/link'));
    return;
  }
  const index = readFileSync(join(root, 'index.html'));

  const send = (reply: import('fastify').FastifyReply, file: string | null) => {
    reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('x-frame-options', 'DENY');
    if (!file) return reply.header('content-type', TYPES['.html']).header('cache-control', 'no-cache').send(index);
    // Vite names built files by content hash, so they never change
    const hashed = file.includes(`${sep}assets${sep}`);
    return reply
      .header('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
      .header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(readFileSync(file));
  };

  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (HUB_PATHS.test(path)) return reply.code(404).send({ error: 'Not found' });
    const file = normalize(join(root, path));
    if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) return send(reply, file);
    // a missing file with an extension is a real 404, not an app page
    if (extname(path)) return reply.code(404).send({ error: 'Not found' });
    return send(reply, null);
  });
}
