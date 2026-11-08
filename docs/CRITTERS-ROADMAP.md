# Critters: art and animation roadmap

The Now Playing critters (`src/components/critters/`) are going from flat, front-facing "paper dolls" to
punchier musical performers. This is the plan, agreed in November 2026, and where each phase stands. The art is
all drawn for Wavelength; games like Incredibox, Rhythm Heaven and Animal Crossing are references for feel only.

| Phase | What | Size | Status |
|---|---|---|---|
| 1 | Faces that sing: mouth shapes, brows, eye acting, species details | medium, 1 PR | **Done** |
| 2 | Rhythm and secondary motion: tempo tracker, beat-locked bobs, strumming, flourishes, contact shadows | medium, 1 PR | **Done** (same PR as phase 1) |
| 3 | Silhouettes and the 3/4 turn: 6 faces redrawn, 4 body templates | large, 2–3 PRs | **Faces done**; bodies next |
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

## Phase 2: rhythm and secondary motion (done)

- **Tempo tracker** (`player/tempo.ts`): the gaps between the analyser's bass hits are folded into one octave
  (0.4–0.8 s, 75–150 BPM) and voted into 10 ms bins for the period; hits near the grid pull its phase a third of
  the way and build confidence; it counts as locked above half. It keeps going between hits and free-runs when
  the audio can't be read. Tests cover jitter (±20 ms), missed and extra hits, and silence.
- Once locked, the rig's `bob`, an alternating sway, the tail (one way per beat) and the ears ride the grid; the
  country boot and every act that uses `bob` follow it too.
- **Strumming** (`guitar.ts`): down on the beat and up between, eighth notes on the rocker's guitar and a
  four-stroke roll on the banjo, deeper when the band is loud; a strong high hit still gets a hard strum.
- **Flourishes** (`flourish.ts`, drawn per act): on a new song, or 2.5 s into a loud gap after a sung line, at most
  every 12 s. Banjo spin and hat tip (Country), double-scratch with a hand in the air (DJ), shades pushed up onto
  the cap (Rapper; the hype hand alone since the shades came off), windmill strum (Rocker), fill into the crash (Drums), antenna swoop (Theremin), glissando
  (Synth), a long bellows stretch (Accordion). Each starts with a small wind-up (anticipation).
- **Contact shadows** (`Shadow` in `parts.tsx`) under feet, stands, amps, speakers, the drum kit and the campfire.
- Not done yet: a solo needs synced lyrics to be noticed; without them only song changes trigger a flourish.

## Phase 3: silhouettes and the 3/4 turn

- **Style frame, signed off (November 2026):** the Country raccoon in the new style, then a sheet of all six
  heads. Both are in `docs/critters/` (`country-raccoon.html`, `face-sheet.html`; open them in a browser). The
  first try kept the old raccoon's proportions and read as odd; the signed-off face is a big round chibi head
  with the eyes low and wide, cheek fluff flaring out at the mask and a small central nose and mouth.
- **Faces (done):** all six redrawn in `faces.tsx` in that style: a dark outline, radial "vinyl" shading lit
  from the upper left, a rim of stage light on the right edge (the skin's `--viz-high`), and big eyes with a
  coloured iris and two highlights. The heads turn only slightly (the eyes, brows and mouth sit a little to the
  right and the far eye is narrower), so the face still reads clearly at Now Playing size. The named parts are
  the same, so the rig and phases 1–2 work unchanged; the eyes now blink about their own centre, and `fit.eyeY`
  moves shades and glasses to where each species' eyes are.
- **Bodies, signed off (November 2026):** a sheet of the four body types dressed for seven acts
  (`docs/critters/body-sheet.html`). Raccoon: a short chunky top with paws held in front, stout fur legs, big
  feet and a big tail. Bears: a puffy jacket, round paws out at the sides, baggy trousers, mid-stride. Shark:
  one slim torpedo from head to a crescent tail, pectoral fins high on the sides, a white belly, no legs and
  no dorsal fin. Aliens: spindly arms and legs, a short thick neck so the head rests on the collar, and a hover
  glow under the feet. On review: rim light stays on heads only (on bodies it read as a red outline); the
  green alien wears a space-age tunic, not a space suit and not bare. Heads are smaller against the body than
  in the app today.
- **Bodies in the app (done):** `bodies.tsx` gives each species a figure: a smaller head, its top, shoulders on
  the top's outer edges, sleeve width, paw size, a reach that keeps hands from stretching to the old wide body's
  instruments, and its legs, feet, neck and tail. The acts kept their poses and pivots; `Pivot` moves each arm,
  the tail and the country boot onto the figure's own joints.
- **Next:** the act outfits fitted to these bodies (phase 4).
- The skeleton contract (named parts, the mouth anchor, shoulders and hands) stays, so the rig and phases 1–2
  carry over.

## Phase 4: species-fitted outfits and act colourways

- Each act's clothes drawn for the 4 body types (8 × 4 = 32 outfits), starting from the review sheet of the seven
  acts other than Country in the new style (`docs/critters/outfit-sheet.html`, November 2026; after review the Synth visor,
  the Rapper's shades and the Rocker's mohawk came off and the Rapper's cap turned backwards, and the
  Theremin space suit became a space-age tunic; the app outfits had all of that by November 2026); for example the shark's throat bandana,
  sleeveless denim vest around the fin and fin strap; the aliens' neon-wire hat and hover banjo; the raccoon's
  patchwork vest, rolled sleeves and slouch hat; the bear's shearling vest and notched Stetson.
- **Colours: the clothes keep following the app skin** (decided November 2026). The outfit sheet's own colours
  per act were only for the drawings; in the app each outfit's main colours take the skin's `--accent` and
  `--viz-*`, with fixed colours kept for materials (denim, leather, chrome, gold).
- Holiday hats and skin outfits refitted as each body type lands.

## Girl critters (November 2026)

- A Boy / Girl switch (`critterLook`, synced): girls get lashes and a bow in the skin's accent in
  place of the act's hat (the beanie stays, with the bow on it). The Rapper's backwards cap came off for everyone.
- A moose (seventh species, November 2026): a big overhanging muzzle with wide nostrils, a fur bell under the
  chin, long ears out to the sides and broad palmate antlers. The antlers are drawn behind the head, so every
  act's hat and the headphones sit between them with the palms showing either side; the hazmat hood hides them.
  Its figure (`FIGURES.moose`) is a deep chest on long legs with pale stockings and cloven hooves (or the act's
  shoes), and a tiny tail.
- A sasquatch was drawn and then put on hold. Its face and figure are in git history (commit
  f284a5b, `SasquatchFace` and `FIGURES.sasquatch`) if it comes back.

## Phase 5: stage lighting

- Per-act rim light on the lit side of each silhouette; Country sunset and lantern flicker with dust motes,
  DJ/Rocker strobe and smoke, Synth/Theremin tractor-beam cone.
- A frame-time budget measured on the slowest supported device, and a "Reduce stage effects" setting that also
  follows `prefers-reduced-motion`.
