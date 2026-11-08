import type { RigFrame } from './rig';

export interface Bend {
  /** degrees to turn the forearm about the elbow (positive turns it clockwise on screen) */
  turn?: number;
  /**
   * move the hand by this much (x, y in scene units) from where the act drew it: the forearm swings and
   * stretches a little from the elbow to follow, the upper arm stays still. The stretch is held to 0.75–1.25
   * of the drawn forearm, so a far target is only reached as far as the forearm goes.
   */
  to?: [number, number];
  /** degrees to tip the hand (and what it holds) on top of the forearm's own turn: a wrist flick */
  wrist?: number;
}

type Joint = { ex: number; ey: number; hx: number; hy: number };
const joints = new WeakMap<SVGElement, Joint>();

function joint(fore: SVGElement): Joint {
  let j = joints.get(fore);
  if (!j) {
    const [ex, ey] = fore.dataset.elbow!.split(' ').map(Number);
    const [hx, hy] = fore.dataset.hand!.split(' ').map(Number);
    j = { ex, ey, hx, hy };
    joints.set(fore, j);
  }
  return j;
}

const deg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Moves an `Arm`'s forearm and hand from the elbow (parts.tsx), leaving the upper arm where it is. Any turn of
 * the whole arm about the shoulder (`part`'s own transform) still applies on top. Returns where the hand ended
 * up, relative to where it was drawn.
 */
export function bend($: RigFrame['$'], part: string, { turn = 0, to = [0, 0], wrist = 0 }: Bend): [number, number] {
  const fore = $(`${part}-fore`);
  const paw = $(`${part}-paw`);
  if (!fore || !paw) return [0, 0];
  const { ex, ey, hx, hy } = joint(fore);
  const vx = hx - ex;
  const vy = hy - ey;
  const len = Math.hypot(vx, vy) || 1;
  let wx = vx + to[0];
  let wy = vy + to[1];
  const want = Math.hypot(wx, wy) || 1;
  const s = Math.min(1.25, Math.max(0.75, want / len));
  wx = (wx / want) * len * s;
  wy = (wy / want) * len * s;
  const from = Math.atan2(vy, vx);
  const turnRad = (turn * Math.PI) / 180;
  const ang = Math.atan2(wy, wx) + turnRad;
  // where the hand lands: the stretched, turned forearm from the elbow
  const nx = ex + Math.cos(ang) * len * s;
  const ny = ey + Math.sin(ang) * len * s;
  const a = deg(ang);
  // the sleeve: turned to the new angle and stretched only along its length, so it keeps its width
  fore.setAttribute(
    'transform',
    `translate(${ex.toFixed(2)} ${ey.toFixed(2)}) rotate(${a.toFixed(2)}) scale(${s.toFixed(3)} 1) rotate(${(-deg(from)).toFixed(2)}) translate(${(-ex).toFixed(2)} ${(-ey).toFixed(2)})`,
  );
  // the hand and what it holds: carried rigidly to the new spot, turned with the forearm
  paw.setAttribute(
    'transform',
    `translate(${nx.toFixed(2)} ${ny.toFixed(2)}) rotate(${(a - deg(from) + wrist).toFixed(2)}) translate(${(-hx).toFixed(2)} ${(-hy).toFixed(2)})`,
  );
  return [nx - hx, ny - hy];
}

/**
 * Where we are in the beat and the bar, for hands that play patterns: the tempo grid once it's locked on,
 * else a steady 120 BPM clock (paused or unreadable audio), so the patterns keep going either way.
 */
export function beatClock({ t, tempo }: Pick<RigFrame, 't' | 'tempo'>): { phase: number; index: number } {
  if (tempo.locked) return { phase: tempo.phase, index: tempo.index };
  const beats = t * 2;
  return { phase: beats % 1, index: Math.floor(beats) };
}

/** 0 on the beat, rising to 1 halfway through it and back down onto the next: a stick or a key lifting between hits. */
export const lift = (phase: number) => Math.sin(Math.PI * phase) ** 0.8;
