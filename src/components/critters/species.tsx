import type { ComponentType } from 'react';
import type { Species } from '../../store/settings';
import { RaccoonFace, Tail as RaccoonTail } from './parts';

/**
 * Who plays: each species is a face (drawn on the shared skeleton, see parts.tsx) and an optional tail.
 * Every act (DJ, Country, …) draws the scene, clothes and instrument and puts the species' face on top,
 * so any species can play any act. Skin colours for hands and bare arms come from CSS variables set on
 * `.species-<id>` in styles.css (`--skin`, `--skin-dark`).
 */
/** What every act component takes. */
export interface ActProps {
  species: SpeciesInfo;
  /** draw one paused frame and stop (Settings cards) */
  still?: boolean;
}

export interface SpeciesInfo {
  id: Species;
  /** "raccoon", "grey alien": the act's label goes in front ("Rocker raccoon") */
  noun: string;
  /** Settings card label */
  label: string;
  Face: ComponentType;
  /** wagged by the rig about 268,292; omit for no tail */
  Tail?: ComponentType;
}

/** Teeth along the grin, a quadratic from 164,206 through 200,232 to 236,206. */
const TEETH = [174, 184, 194, 206, 216, 226]
  .map((x) => {
    const k = (x - 164) / 72;
    const y = 206 + 52 * k * (1 - k) - 1;
    return `M${x - 4} ${y.toFixed(1)} L${x + 4} ${y.toFixed(1)} L${x} ${(y + 6).toFixed(1)} Z`;
  })
  .join(' ');

/** The shark's face for `Head`: dorsal fin, gills, white jaw and a toothy grin, on the shared skeleton. */
function SharkFace() {
  return (
    <>
      <path className="shark-skin" d="M174 124 Q 194 70 238 60 Q 222 92 228 126 Z" />
      <path className="shark-dark" d="M196 90 Q 214 70 238 60 Q 226 80 224 100 Z" />
      <ellipse className="shark-skin" cx="200" cy="178" rx="82" ry="66" />
      <path className="shark-belly" d="M122 194 Q 130 240 200 245 Q 270 240 278 194 Q 240 214 200 214 Q 160 214 122 194 Z" />
      <path className="shark-gill" d="M130 170 q -6 12 0 24 M140 166 q -6 14 0 28 M272 170 q 6 12 0 24 M262 166 q 6 14 0 28" fill="none" strokeWidth="3" strokeLinecap="round" />
      <g data-part="eyes">
        <circle cx="170" cy="166" r="10" fill="#fff" />
        <circle cx="230" cy="166" r="10" fill="#fff" />
        <circle cx="172" cy="167" r="6.5" fill="#111" />
        <circle cx="228" cy="167" r="6.5" fill="#111" />
        <circle cx="174" cy="164" r="2" fill="#fff" />
        <circle cx="230" cy="164" r="2" fill="#fff" />
      </g>
      <path className="shark-gill" d="M188 190 q 5 -4 10 0 M202 190 q 5 -4 10 0" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      <g data-part="smile">
        <path d="M164 206 Q 200 232 236 206" fill="none" stroke="#1e2a36" strokeWidth="3.5" strokeLinecap="round" />
        <path d={TEETH} fill="#fff" />
      </g>
      <ellipse data-part="yawn" cx="200" cy="222" rx="16" ry="12" fill="#5a1a24" transform="scale(1 0)" />
    </>
  );
}

function SharkTail() {
  return <path data-part="tail" className="shark-skin" d="M262 286 Q 296 292 318 276 L 340 230 Q 346 262 336 282 Q 352 296 360 318 Q 330 304 314 306 Q 290 310 262 302 Z" />;
}

/** The alien's face for `Head`: a bulb-shaped green head with big black eyes and glowing antennae, on the shared skeleton. */
function AlienFace() {
  return (
    <>
      <path className="alien-dark" d="M178 110 Q 168 82 154 66 M222 110 Q 232 82 246 66" fill="none" strokeWidth="4" strokeLinecap="round" />
      <circle data-glow="" className="antenna" cx="154" cy="64" r="8" filter="url(#critter-glow)" />
      <circle data-glow="" className="antenna" cx="246" cy="64" r="8" filter="url(#critter-glow)" />
      <path className="alien-skin" d="M200 104 C 268 104 290 150 282 182 C 274 222 238 246 200 246 C 162 246 126 222 118 182 C 110 150 132 104 200 104 Z" />
      <path className="alien-dark" d="M150 124 q 6 -4 12 0 M238 124 q 6 -4 12 0 M196 116 q 4 -3 8 0" fill="none" strokeWidth="3" strokeLinecap="round" />
      <circle className="alien-dark" cx="138" cy="200" r="4" /><circle className="alien-dark" cx="262" cy="200" r="4" />
      <g data-part="eyes">
        <path d="M130 150 Q 162 142 186 166 Q 180 188 160 186 Q 134 180 130 150 Z" fill="#111" />
        <path d="M270 150 Q 238 142 214 166 Q 220 188 240 186 Q 266 180 270 150 Z" fill="#111" />
        <circle cx="150" cy="158" r="4.5" fill="#fff" />
        <circle cx="232" cy="162" r="4.5" fill="#fff" />
        <circle cx="168" cy="176" r="1.8" fill="#fff" />
        <circle cx="250" cy="176" r="1.8" fill="#fff" />
      </g>
      <circle cx="195" cy="198" r="2.2" fill="#2b4a1f" /><circle cx="205" cy="198" r="2.2" fill="#2b4a1f" />
      <path data-part="smile" d="M184 214 Q 200 226 216 214" fill="none" stroke="#2b4a1f" strokeWidth="3" strokeLinecap="round" />
      <ellipse data-part="yawn" cx="200" cy="220" rx="10" ry="10" fill="#3a1030" transform="scale(1 0)" />
    </>
  );
}

/** The grey's face for `Head`: a big bulb head with a pointed chin and huge black eyes, on the shared skeleton. */
function GreyFace() {
  return (
    <>
      <path className="grey-skin" d="M200 92 C 272 92 298 140 290 180 C 282 216 236 248 200 254 C 164 248 118 216 110 180 C 102 140 128 92 200 92 Z" />
      <path className="grey-shade" d="M150 104 C 112 124 102 160 110 186 C 118 218 160 246 196 254 C 160 238 126 208 122 176 C 118 146 128 120 150 104 Z" />
      <ellipse cx="248" cy="116" rx="20" ry="7" transform="rotate(28 248 116)" fill="rgb(255 255 255 / 0.55)" />
      <circle cx="226" cy="104" r="2" fill="rgb(255 255 255 / 0.7)" /><circle cx="234" cy="102" r="1.6" fill="rgb(255 255 255 / 0.7)" />
      <path className="grey-line" d="M126 150 Q 150 128 186 148 M274 150 Q 250 128 214 148" fill="none" strokeWidth="2" strokeLinecap="round" />
      <g data-part="eyes">
        <ellipse cx="160" cy="168" rx="34" ry="22" fill="#0b0b0d" transform="rotate(22 160 168)" />
        <ellipse cx="240" cy="168" rx="34" ry="22" fill="#0b0b0d" transform="rotate(-22 240 168)" />
        <ellipse cx="152" cy="160" rx="7" ry="4.5" fill="#fff" transform="rotate(-10 152 160)" />
        <ellipse cx="246" cy="160" rx="7" ry="4" fill="#fff" transform="rotate(-25 246 160)" />
      </g>
      <path className="grey-line" d="M194 204 h4 M202 204 h4" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      <path data-part="smile" d="M188 222 Q 200 230 212 222" fill="none" className="grey-line" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse data-part="yawn" cx="200" cy="226" rx="8" ry="9" fill="#2a2030" transform="scale(1 0)" />
    </>
  );
}

/** The bear's face for `Head`: round ears, a pale muzzle and a big nose. Fur colour comes from `--bear-fur` (black or brown, styles.css). */
function BearFace() {
  return (
    <>
      <circle className="bear-fur" cx="140" cy="122" r="24" />
      <circle className="bear-fur" cx="260" cy="122" r="24" />
      <circle className="bear-muzzle" cx="140" cy="122" r="12" />
      <circle className="bear-muzzle" cx="260" cy="122" r="12" />
      <ellipse className="bear-fur" cx="200" cy="178" rx="82" ry="68" />
      <ellipse className="bear-fur-dark" cx="200" cy="226" rx="56" ry="18" />
      <ellipse className="bear-muzzle" cx="200" cy="208" rx="36" ry="27" />
      <g data-part="eyes">
        <circle cx="168" cy="166" r="7" fill="#111" />
        <circle cx="232" cy="166" r="7" fill="#111" />
        <circle cx="170" cy="163" r="2" fill="#fff" />
        <circle cx="234" cy="163" r="2" fill="#fff" />
      </g>
      <ellipse cx="200" cy="194" rx="13" ry="9" fill="#111" />
      <ellipse cx="196" cy="191" rx="4" ry="2" fill="rgb(255 255 255 / 0.5)" />
      <path d="M200 203 V212" stroke="#2b1d12" strokeWidth="2.5" strokeLinecap="round" />
      <path data-part="smile" d="M186 212 Q 200 224 214 212" fill="none" stroke="#2b1d12" strokeWidth="3" strokeLinecap="round" />
      <ellipse data-part="yawn" cx="200" cy="222" rx="12" ry="12" fill="#5a1a24" transform="scale(1 0)" />
    </>
  );
}

/** In picker order. To add a species: a face (and tail) here, an entry below, its id in `Species`, colours in styles.css. */
export const SPECIES: SpeciesInfo[] = [
  { id: 'raccoon', noun: 'raccoon', label: 'Raccoon', Face: RaccoonFace, Tail: RaccoonTail },
  { id: 'shark', noun: 'shark', label: 'Shark', Face: SharkFace, Tail: SharkTail },
  { id: 'alien', noun: 'alien', label: 'Alien', Face: AlienFace },
  { id: 'grey', noun: 'grey alien', label: 'Grey alien', Face: GreyFace },
  { id: 'bear-black', noun: 'black bear', label: 'Black bear', Face: BearFace },
  { id: 'bear-brown', noun: 'brown bear', label: 'Brown bear', Face: BearFace },
];
