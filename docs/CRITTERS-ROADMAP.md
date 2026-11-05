# Critters: art and animation roadmap

The Now Playing critters (`src/components/critters/`) are going from flat, front-facing "paper dolls" to
punchier musical performers. This is the plan, agreed in November 2026, and where each phase stands. The art is
all drawn for Wavelength; games like Incredibox, Rhythm Heaven and Animal Crossing are references for feel only.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Faces that sing: mouth shapes, brows, eye acting, species details | medium, 1 PR | **Done** (this file's first PR) |
| 2 | Rhythm and secondary motion: tempo tracker, beat-locked bobs, strumming, flourishes, contact shadows | medium, 1 PR | Next |
| 3 | Silhouettes and the 3/4 turn: 6 faces redrawn, 4 body templates | large, 2–3 PRs | Starts with a style frame for sign-off |
| 4 | Species-fitted outfits and act colourways | large, ~4 PRs (2 acts each) | After 3 |
| 5 | Stage lighting: rim light, set lighting, particles, reduced-effects switch | medium, 1–2 PRs | After 4 |

## Where the critters started

- Every critter is a front-facing face on one shared skeleton (head centred on 200,178, eyes on y 166, mouth on
  y 212, one `TORSO` path), so any of the 6 species can play any of the 8 acts with no per-pair drawing.
- Each act draws one set of clothes and one hat that every species wears, refitted by a width and lift factor
  (`fit` in `species.tsx`). Clothes take the app skin's `--accent` colours.
- Before phase 1 the mouth was one dark oval scaled open and shut. Its timing was good (about 33 ms behind the
  voice, see the singing check in the project's reviews); its shape never changed.
- Heads nod on detected bass hits (`analysis.ts`), not on a steady tempo.

## What the rendering can do

Everything below is inline SVG animated by `rig.ts`, writing transforms straight onto `data-part` elements each
frame with no React re-render. That covers all of the plan; the cost is drawing time, not the renderer.

**Style: stylized vector (flat 2.5D), with soft "vinyl" shading** from radial gradients, a light inner shadow
and a subtle texture pattern per material (denim, fleece, canvas). True 3D vinyl characters were ruled out: they
need modelled and rigged 3D assets, a WebGL engine (three.js, ~150 KB+) and per-act 3D props, roughly ten times
the asset work and a risk on low-end phones and the iOS WebView.

## Phase 1: faces that sing (done)

- **Six mouth shapes** (`player/visemes.ts`): `rest` (the closed smile), `ah`, `oh`, `ee`, `mm` (lips pressed,
  for m/b/p) and `smile` (open grin, used when belting). `Mouth` in `parts.tsx` draws them in a frame around the
  mouth's centre and top, so redrawn faces can reuse them.
- **Picking the shape**: with synced lyrics, `syllableShapes` gives each syllable's vowel (spelling, not
  phonetics) and `singing.ts` reports the one being sung; without lyrics, `vowelFromFormants` guesses from three
  bands of the centre spectrum (~250–550 Hz, ~550–1000 Hz, ~1.8–3 kHz). The guess has not been measured against
  real vocals; it's there so the mouth changes shape the way singing does.
- **Acting** (`components/critters/face.ts`): shapes hold at least 80 ms; brows lift on a crescendo (the band's
  fast level above its slow average) or a long held note; eyes squint on bright (high) voices; an accent pulse on
  drum hits; a blink on about every eighth beat.
- **Species details**: shark teeth rows in every open shape; raccoon whiskers and snarl; alien antennae that glow
  with a bright voice; alien and grey eye shines that widen on loud notes; bear ears that flick.

## Phase 2: rhythm and secondary motion

- A tempo tracker that locks onto the detected beats and gives a steady beat phase, bar count and BPM, falling
  back to a gentle tempo when the audio can't be read.
- Bobs and taps on the beat, ear wiggle on the bounce (bears, raccoon), tail sway in time (shark, raccoon),
  boot-heel tap (raccoon).
- Strumming and plucking on beat subdivisions (`guitar.ts`) rather than only on hits.
- One flourish per act on a track change or a solo (a gap between synced lines with high energy): banjo spin
  (Country), record scratch (DJ), shades push-up (Rapper), knob twist (Synth), and so on.
- Soft contact shadows under feet, instruments and props.

## Phase 3: silhouettes and the 3/4 turn

- A style frame of one critter (the Country raccoon) for sign-off before the rest is drawn.
- Redraw the 6 faces at a 3/4 angle, and replace the shared torso with 4 body templates: raccoon compact and
  hunched, shark broad wedge, aliens spindly and floating, bears heavy and grounded.
- The skeleton contract (named parts, the mouth anchor, shoulders and hands) stays, so the rig and phases 1–2
  carry over.

## Phase 4: species-fitted outfits and act colourways

- Each act's clothes drawn for the 4 body types (8 × 4 = 32 outfits), for example the shark's throat bandana,
  sleeveless denim vest around the fin and fin strap; the aliens' neon-wire hat and hover banjo; the raccoon's
  patchwork vest, rolled sleeves and slouch hat; the bear's shearling vest and notched Stetson.
- A fixed palette per act (Country ochre and denim, Synth cyan and magenta, …) with the app skin tinting only
  lights and glow. **Open decision** before this phase: today the clothes follow the skin colours.
- Holiday hats and skin outfits refitted as each body type lands.

## Phase 5: stage lighting

- Per-act rim light on the lit side of each silhouette; Country sunset and lantern flicker with dust motes,
  DJ/Rocker strobe and smoke, Synth/Theremin tractor-beam cone.
- A frame-time budget measured on the slowest supported device, and a "Reduce stage effects" setting that also
  follows `prefers-reduced-motion`.
