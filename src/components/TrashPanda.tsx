import { RaccoonFace } from "./critters/faces";

/**
 * DJ Trash Panda, the AI DJ's face (views/DJ.tsx): the critters' raccoon head with headphones, rave shades and
 * a glow stick, in the skin's accent colours. Static, so a long chat doesn't animate dozens of them.
 */
export const DJ_NAME = "DJ Trash Panda";

export function TrashPanda({ busy }: { busy?: boolean }) {
  return (
    <svg
      className={`critter species-raccoon trash-panda ${busy ? "busy" : ""}`}
      viewBox="96 76 208 190"
      role="img"
      aria-label={DJ_NAME}
    >
      <RaccoonFace />
      {/* headphones */}
      <path
        d="M118 176 C 112 96, 288 96, 282 176"
        fill="none"
        className="tp-band"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <rect x="104" y="160" width="26" height="40" rx="10" className="tp-cup" />
      <rect x="270" y="160" width="26" height="40" rx="10" className="tp-cup" />
      {/* rave shades, over the eyes (y 186) */}
      <g transform="translate(200 186) scale(1.1) translate(-200 -168)">
        <path
          d="M146 156 H 254 Q 256 178 236 182 Q 214 184 206 166 H 194 Q 186 184 164 182 Q 144 178 146 156 Z"
          className="tp-shades"
        />
        <path
          d="M152 162 H 190 M210 162 H 248"
          className="tp-shine"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      {/* glow stick */}
      <rect
        x="252"
        y="214"
        width="9"
        height="44"
        rx="4.5"
        transform="rotate(28 256 236)"
        className="tp-glow"
      />
    </svg>
  );
}
