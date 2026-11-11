import { parentPort } from 'node:worker_threads';
import { analyse } from './analyse.ts';

/**
 * The worker thread sound-alike analysis runs in (worker.ts `analyseOff`). analyse() takes about half a second a
 * song on a fast CPU and a second or two on a NAS, all of it synchronous; on the main thread every Hub request
 * (search, lyrics, the DJ, sign-in) waited behind it for hours on end during the first analysis.
 */
parentPort?.on('message', (m: { id: number; samples: Float32Array }) => {
  try {
    parentPort?.postMessage({ id: m.id, features: analyse(m.samples) });
  } catch (e) {
    parentPort?.postMessage({ id: m.id, error: String((e as Error).message ?? e) });
  }
});
