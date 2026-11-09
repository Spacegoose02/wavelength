import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const br = promisify(brotliCompress);
const gz = promisify(gzip);
/** smaller than this isn't worth the work */
const MIN = 1024;
const TEXT = /^(application\/(json|javascript|xml)|text\/)/i;

/**
 * Zip the Hub's text answers (JSON, the Subsonic API's album lists and the like) for clients that ask for it, as
 * Navidrome does. A page of 500 albums is about 155 KB plain and a tenth of that zipped. Streams (songs, covers,
 * files) and anything already encoded go out as they are. Brotli at a fast level when the client takes it, else gzip;
 * both run off the main thread.
 */
export function compressReplies(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    if (reply.hasHeader('content-encoding') || req.method === 'HEAD') return payload;
    const type = String(reply.getHeader('content-type') ?? '');
    if (!TEXT.test(type)) return payload;
    const size = Buffer.byteLength(payload);
    if (size < MIN) return payload;
    const accept = String(req.headers['accept-encoding'] ?? '');
    const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    reply.header('vary', 'accept-encoding');
    if (!enc) return payload;
    const out = enc === 'br'
      ? await br(payload, { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_SIZE_HINT]: size } })
      : await gz(payload, { level: 6 });
    reply.header('content-encoding', enc);
    reply.removeHeader('content-length');
    return out;
  });
}
