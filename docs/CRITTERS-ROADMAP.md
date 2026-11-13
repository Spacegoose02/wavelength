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
- A turtle (eighth species, November 2026), kept clear of any famous cartoon turtle (no mask, no bandana,
  no spiky shell, no orange shell with a yellow front). Sea-green skin with a soft mint muzzle and a few gold
  freckles, big blue eyes, rosy cheeks and a wide smile. A first draft had a hooked beak and heavy lids; it
  looked grumpy, so the face was redrawn cuter. Its figure (`FIGURES.turtle`) draws a high domed shell under
  the top, wider than it, so the gold-rayed rim shows round any act's clothes while the arms and instruments go
  in front; then stumpy legs with blunt claws (or the act's shoes) and a pointed tail. No ears or horns, so
  every hat fits the head unchanged.
- An elephant, a tiger and a lion (November 2026), drawn cute and kept clear of famous cartoon ones (no flying
  ears or bonnet, no blue nose or bouncy tail, no crown). The elephant's ears are `ear-l` / `ear-r` like the bears',
  but styles.css keeps them out under the cowboy hat and turns them from where they join the head, so they flap;
  its trunk is outlined down its sides only, so it grows out of the face, and sweeps out to the left with its tip
  up, over a wide smile that shows either side of it; the singing mouth opens just right of centre, under the
  trunk's bend (it first sat off to one side of a long trunk and read oddly). The tiger and lion share a big-cat figure (`bigCat` in bodies.tsx) with their own
  tails. The lion's mane is drawn behind the head and left out for the girl, who is a lioness. The hazmat hood
  hides the elephant's ears and trunk and the lion's mane (`.elephant-ears`, `.elephant-trunk`, `.lion-mane`).
- A panda (November 2026), drawn cute and kept clear of famous cartoon pandas (no jade eyes, no kung-fu
  headband). Its round black ears are `ear-l` / `ear-r` like the bears', so the rig wiggles them and the cowboy
  hat and hazmat hood hide them. The eye patches are drawn outside the `eyes` group so blinks don't squash them,
  and the girl's lashes are pale (`.species-panda .lashes`) so they show on the black. `FIGURES.panda` is a chubby
  top on short black legs with pale toe pads and a little white puff of a tail.
- An owl and a T. rex (November 2026), drawn cute and kept clear of famous cartoon ones (no snowy post owl,
  spectacles or mortarboard; no purple dinosaur). The owl's ear tufts are `ear-l` / `ear-r` like the bears' ears,
  so the rig wiggles them and the cowboy hat hides them. Two optional `Figure` fields shape the arms (`Arm` in
  parts.tsx): `hand: 'wing'` ends the owl's arms in one rounded wing tip with three scalloped feathers (`wingTip`) (its sleeves are bare,
  `.species-owl .sleeve`), and the T. rex's `fore` makes the forearm thinner than the upper arm, so
  the short arm reads as bending at a little elbow, with `hand: 'claws'` adding two claws. Its shoulders sit high
  and close on the chest, but its `reach` is the usual, so its hands still land on every instrument. The T. rex
  tail sweeps along the ground to the right behind the legs, with little plates (`.dino-plate`).
- A monkey, a flamingo and a gorilla (November 2026), drawn cute and kept clear of famous cartoon ones (no fez,
  vest or yellow-hat friend; no necktie or initials). The monkey's round ears are `ear-l` / `ear-r` out at the sides at
  eye level, so styles.css keeps them out under the cowboy hat like the elephant's (the hazmat hood hides them,
  `.monkey-ears`); its figure has thin legs, long peach feet and a long tail curling at the tip. The flamingo's bill
  is drawn over the singing mouth, which opens on the bill like a beak opening (a mouth either side of the bill's
  tip didn't show); its head sits higher than anyone's on a short visible neck, its wings are its arms (`hand:
  'wing'`, black tips) and it stands on long thin legs with webbed feet. The gorilla has the broadest shoulders,
  thickest arms and longest reach, a heavy brow (the brows are drawn thick so they still act) and no tail.
- Two acts came with them: **Marimba** (jungle, `Marimba.tsx`): each hand moves between the bars its mallet can
  reach from where that species' hand rests, so the struck bar is always under the mallet; **Violinist** (rainy
  street, `Violin.tsx`): the bow slides along its own length and the wrist turns against the forearm so the bow
  keeps its slant.
- Nine more (November 2026): a penguin, fox, axolotl, sloth, octopus, dragon, frog, bunny and red panda. Most share
  one soft round body (`roundFigure` in `bodies.tsx`) with their own tail, feet and markings; the octopus is its own
  figure, six tentacles in the `tail` part with an empty boot. Three move their own way through `Figure.move`, which
  `CritterFrame` puts on the svg as `data-move` for the rig: the sloth (`late`) runs the beat half a beat behind,
  and off the beat grid its bob trails by a quarter second; the frog (`hop`) hops the head and body up on each beat.
  The dragon's face has a hidden `smoke` part the rig puffs out on a flourish. The axolotl's gills, the dragon's
  wings and the bunny's ears go under the hazmat hood.
- Three more scenes (November 2026): **Saxophone** (`Sax.tsx`, a city rooftop), **Harpist** (`Harp.tsx`, the clouds) and
  **Tuba** (`Tuba.tsx`, a snowy square). The wind players turn the rig's `talk` off, since their mouths are on the
  mouthpiece. The sax tips about the mouthpiece and the hands follow the keys (`turned`); the harp's neck and
  strings come from the same `neckY` / `boxY` lines, so the strings always meet the frame.
- Revamp (November 2026, from feedback): the Saxophone, Harpist and Tuba were retired (the wind players didn't sing
  and the harp hands barely touched the strings) for two guitar scenes and a singing one: **Acoustic**
  (`Acoustic.tsx`, a cosy room), **Surf rock** (`Surf.tsx`, the beach) and **Singer** (`Singer.tsx`, a stage, the mic
  held off to the side so the whole singing mouth shows, the free hand opening out on held notes from
  `singingReading.mouth`). A saved pick of a retired act moves to its replacement (`RETIRED_ACTS` in
  `store/settings.ts`, used by the settings merge and `findAct`). The newer scenes' painted skies and walls (Driver,
  Bongo, Marimba, Violinist, Pianist, Reactor) were dropped or made translucent so the album colours show through,
  like the first eight scenes; the beach keeps its sea and sand. The penguin got real flippers (`hand: 'flipper'`,
  a paddle carried on along the forearm instead of a round hand) and a new face; the flamingo's mouth now opens
  under its bill instead of through it; the sloth's face was redrawn; the octopus got two more arms (`OctoArms`,
  `tentacle-l` / `tentacle-r` waved by the rig, and two more sticks on the Drummer); the dragon went charcoal black
  with lime eyes and ear fins. A **turkey** joined: an original maroon-and-orange bird in a college-mascot spirit,
  with a tail fan (`Back` on its round figure).
- An **opossum** joined (November 2026): a pale face under a grey crown, round black ears with pale rims, a long
  snout with a big pink nose and a mouthful of little teeth when it sings (`teeth="rows"`), pink hands (a
  `.hand` override in styles.css) and paws, and a long bare pink tail with a dark furry base on its round figure.
  On a flourish it plays dead for a moment: its face has a hidden `play-dead` part (fur over the eyes, crossed-out
  eyes and a lolling tongue) that the rig shows through the middle of the flourish, like the dragon's `smoke`.
- Eight more (November 2026): a capybara, crocodile, dolphin, goat, peacock, pangolin, bat and polar bear, each
  with a character in mind (any of them can still play any act). The **capybara** is the chill one: sleepy
  half-lidded eyes up high on a boxy head, a long blunt muzzle and an orange on its head (`.capybara-orange`,
  under the hazmat hood). The **crocodile** has its eyes up in two bumps like the frog, so its `fit.lift` raises
  hats clear of them; a toothy grin and the `rows` singing mouth; a long tail with scutes. The **dolphin** is
  built like the shark (no legs, an open vest on its own skin) with flippers and flat flukes. The **goat** has
  horns behind the head and ears out flat that stay out under the cowboy hat like the elephant's; the hood hides
  horns, ears and beard. The **peacock**'s train is a new `fan` part the rig opens wider on each beat and spreads on
  a flourish. The **pangolin** shares one scale shape (`scale.ts`) between its head hood, the rows of armour behind
  its top and the tail. The **bat**'s wings are new `wing-l` / `wing-r` parts that flap on the beat. The
  **polar bear** has its own face (longer head, long muzzle, small wide ears) and figure (a broader top, thick legs
  and big black-padded paws), not the bears' face recoloured.
- Four more scenes (November 2026): two more drives on the Driver's car and moves, the **Coast driver** (the beach
  road, palms at the roadside, a lighthouse, a surfboard on the back seat) and the **Night driver** (the city after
  dark, street lamps, a skyline lit bar by bar), now that `Drive.tsx` is one `DriveScene` with a `DrivePlace` per
  drive; **Taiko** (`Taiko.tsx`, a big drum under the cherry blossom, sticks alternating on and off the beat, both
  arms up on the last beat of the bar) and **Disco** (`Disco.tsx`, a hand mic held beside the face so they sing, the
  disco point, a light-up floor and a mirror ball). All four sing along.
- A sasquatch was drawn and then put on hold. Its face and figure are in git history (commit
  f284a5b, `SasquatchFace` and `FIGURES.sasquatch`) if it comes back.

## Phase 5: stage lighting

- Per-act rim light on the lit side of each silhouette; Country sunset and lantern flicker with dust motes,
  DJ/Rocker strobe and smoke, Synth/Theremin tractor-beam cone.
- A frame-time budget measured on the slowest supported device, and a "Reduce stage effects" setting that also
  follows `prefers-reduced-motion`.
