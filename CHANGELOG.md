# Changelog

## Unreleased
- **Settings → Themes & critters.** One place for how Wavelength looks and who plays along, in four sub-tabs:
  **Theme** (skins, Seasonal, Random daily, Motion), **Critters**, **Scenes** (what used to be called acts) and
  **Visualizer**. The Boy / Girl switch sits on both the Critters and Scenes sub-tabs, with a line saying who's
  playing what. The visualizer and critter pickers moved here from Playback, which now points to them, and
  Settings search opens the right sub-tab.
- **Nine more critters: a penguin, a fox, an axolotl, a sloth, an octopus, a dragon, a frog, a bunny and a red panda.**
  The eighteenth to twenty-sixth, drawn cute. The penguin waddles with flippers for arms; the fox has a bushy
  white-tipped tail; the axolotl's frilly gills glow with the bass; the octopus stands on six curling tentacles; the
  bunny has one ear flopped over; the red panda has a ringed tail. Three move their own way: the laid-back sloth plays
  half a beat behind the music, the frog hops on the beat, and the dragon puffs smoke on a flourish (`Figure.move`
  and the `smoke` part, `rig.ts`). All nine play every act as a boy or a girl, with the holiday hats and theme outfits.
- **A monkey, a flamingo and a gorilla.** The fifteenth, sixteenth and seventeenth critters, drawn cute. The monkey is
  brown with a tuft of hair, big round ears out at the sides that stay out under every hat, a peach heart of a face
  and a wide grin, on thin legs with long peach feet and a long tail curling at the tip. The flamingo chick is pink
  with a fluffy crest, golden eyes and a pale bill bending down to a black tip that opens when it sings, on a short
  neck and long thin legs with webbed feet; its wings are its arms, with black feathered tips. The baby gorilla is
  charcoal with a domed crown, a grey leathery face, a heavy brow and a broad nose, on a big broad body with the
  widest shoulders and longest arms of them all. All three play every act as a boy or a girl, with the holiday hats
  and theme outfits (`MonkeyFace`, `FlamingoFace`, `GorillaFace` in `faces.tsx`; `FIGURES.monkey`, `.flamingo`,
  `.gorilla` in `bodies.tsx`).
- **Two new critter acts: Marimba and Violinist.**
  - **Marimba**, in the jungle: a pith helmet and an explorer's khaki shirt with a neckerchief, at a wooden marimba
    in a clearing by a waterfall, with vines, big leaves, a parrot and butterflies. The low hand plays on the beat
    and the high hand on the off-beat, each moving to the bar where the music is loudest; struck bars light up in
    your skin's colour and dip. The waterfall pours faster with the bass and the parrot bobs on the beat. Flourish:
    a fast roll with a glissando of light up the bars, then both hands up (`Marimba.tsx`).
  - **Violinist**, busking in the rain: a long coat, a scarf and a flat cap, playing a violin under a street lamp
    by a brick wall, with a cat nodding along in a lit window and the case open for coins. The bow saws down one
    beat and up the next, fuller when the band is loud; the fingers walk the neck with the melody, the rain falls
    harder with the bass and the puddles ripple on the beat. Flourish: one long sweeping stroke with the bow lifted
    high at the end (`Violin.tsx`).

## 0.35.0
- **The Hub plays the songs from the music folder (phase 4 of replacing Navidrome).** Off by default: **Hub plays
  the songs (beta)** under Settings → Server → Music catalog, separate from the browsing switch, and only while the
  catalog matches Navidrome. For devices that go through the Hub, `stream` and `download` of a song the catalog knows
  come from the music folder: the file as it is, with seeking (Range), an ETag and a length, or converted by ffmpeg as
  it plays when a lower bitrate or another format (mp3, opus, aac) is asked for. Songs the catalog doesn't know, files
  that have gone and other formats still play from Navidrome; scrobbles, stars and playlists stay there, and kids'
  songs are still checked. Navidrome support stays: every Hub phase is a switch (`hub/src/catalogStream.ts`, #238).
- **Radio: a new look for Your stations.** The wall of identical cyan pills is now a grid of cards that follow
  your skin. Messy server names are tidied (*Energy 93@181.FM (Euro EDM)(Dance/Techno)* shows as **Energy 93**,
  *Euro EDM · Dance · Techno*), each station gets its logo or a tile in its genre's colour, and they're grouped
  by genre (**By genre** / **My order** next to the heading). The playing station is outlined with moving bars
  instead of every card having a red dot. Edit mode uses the same cards (#237).
- **Fix: Radio → Favorites** showed the text "row(s)" instead of your favorite stations (#237).

## 0.34.0
- **Edit album and Edit artist, Plex style.** The album page's **Edit album** opens a dialog like Edit song's:
  **General** (album, album artist, sort title, release date, release type and record label), **Tags** (genres and
  moods as chips), **Poster** (the cover picker) and **Info** (songs, folder, formats). It writes what you change
  into every song of the album as one Save you can undo; **Edit each song…** opens the old table. The artist page's
  **Edit artist** has **General** (rename or merge, sort name, a biography shown instead of Wikipedia's),
  **Tags** (their genres), **Poster** (the picture) and **Advanced** (album order: newest, oldest or A to Z).
  The biography and album order are kept on the Hub (migration 32, #233).
- **Albums, Singles & EPs, Compilations.** An artist's page puts their releases on separate shelves, by the release
  type tag (which Edit album sets) or, without one, by song count (#233).
- **Three new critter acts: Reactor, Bongo and Pianist.** Every species plays them, as a boy or a girl, and the
  holiday hats and theme outfits (the hazmat suit in the Nuclear skins) go on as usual.
  - **Reactor**, the nuclear scene: a hard hat and lab coat, rocking a keytar in front of the glowing green core
    of a reactor. The fuel rods light up with the spectrum, the core's glow swells with the bass, amber beacons
    spin on the beat, a Geiger counter's needle jumps with the highs and motes drift up off the core. One hand
    plays chords along the keys (they light up), the other bends notes on the neck's ribbon. Flourish: the keytar
    swings up, the hand sweeps down the keys and the core flares (`Reactor.tsx`).
  - **Bongo**: a straw hat, Hawaiian shirt and flower lei (a grass skirt for girls) on a sunny beach, slapping
    bongos: the small drum on the beat, the big one on the off-beats, both together at the end of the bar. The
    waves roll in with the bass, palms sway, tiki torches flicker and a crab scuttles in time. Flourish: a fast
    roll and both hands up (`Bongo.tsx`).
  - **Pianist**: a tuxedo and bow tie at a grand piano in a jazz lounge under a neon JAZZ sign, playing stride
    (bass note, chord, bass note, chord) with the right hand running along the keys. The keys light up, the lid
    lifts on the bass, music notes float up and the footlights chase on the beat. Flourish: a glissando and a
    burst of notes (`Piano.tsx`, #234).

## 0.33.0
- **Edit song.** Admins can fix one song's tags, Plex style: right-click a song → **Edit song…**, or **Edit** on its
  row. **General** has the title, the main **Artist**, **Featured artists** as chips (pick from your library, paste
  "A, B & C" to add several), album, album artist, track, disc and year; **Tags** has the genres as chips; **Info**
  shows the file and its tags. The credit is written as "Main feat. A; B", the same shape Split joined artists
  writes, so Navidrome files the song under the main artist with the others featured. Features written in the title
  ("Sticky (feat. GloRilla, Sexyy Red & Lil Wayne)") move to the chips with one button, and a "Lil Durk;Drake" credit
  gets a button to write it the way Navidrome splits it. Only changed tags are written; **Undo** is in the dialog and
  under Settings → Server → Tag edits (`src/views/SongEditor.tsx`, `src/lib/songCredit.ts`, Hub
  `GET /api/admin/tags/song/:id`, #231).
- **Merge into…** on an artist's or album's page (Hub admins), the way Plex merges: it lists the artists or albums
  that look like the same one, or type to find another, and the page you're on merges into the one you pick. Same
  merge as Select → Merge, one undo under Settings → Server → Tag edits (`src/components/MergeInto.tsx`, #230).
- **Merging artists catches every song.** Songs where the merged artist is only featured on someone else's album
  are retagged too, and a joined credit merged into one of its artists keeps the rest featured: "Lil Wayne;Drake"
  into Lil Wayne writes Artist "Lil Wayne feat. Drake" and Album artist "Lil Wayne". An album merged into one whose
  songs have no Album artist takes the main artist, not "A feat. B" (`src/lib/merge.ts`, #230).

## 0.32.1
- **Joined artists are the main artist featuring the rest.** A tag like "Lil Durk;Drake" means Lil Durk featuring
  Drake, so the song and its album now belong to Lil Durk. **Library care → Unmatched songs → Split joined
  artists** (and the Hub, for new downloads before Navidrome scans them) writes the Artist tag as "Lil Durk feat.
  Drake" and the Album artist as "Lil Durk", where it used to write "Lil Durk; Drake" and Navidrome listed both as
  equal artists. Credits already written as "Lil Durk; Drake" are listed and fixed the same way, the same artist
  named twice ("Lil Durk;Lil Durk", "Lil Durk Lil Durk") becomes "Lil Durk", and one-word band names twice ("Duran
  Duran") stay. Until the tags are fixed, the app already shows such songs as "Lil Durk feat. Drake" (`tidyCredit`
  in `hub/src/credits.ts` and `src/lib/songIssues.ts`, `src/sources/navidrome.ts`, #229).
- **Lyrics follow the song more often.** When Navidrome (a file's lyrics tag) or the Hub's shared copy only has the
  words without times, LRCLIB is asked for a synced version of the same song, which is used instead (and replaces
  the Hub's copy), so the line being sung lights up. **Wrong lyrics?** also offers **Use with times** on an entry of
  another length, for when its times fit well enough; **Lyrics timing** in Tune mouth can shift them (#226).
- **Fix: searching an artist lists their features as artists.** Search's Artists row listed every credit an artist
  is in as an artist of its own ("Lil Durk • J. Cole", "Calboy;Meek Mill;Lil Durk", "DJ Khaled feat. Lil Baby &
  Lil Durk"), each opening the wrong artist, and the real one was lost among them. The Hub's search now splits each
  credit into its artists (on feat./ft./featuring, •, ;, " / ", and on &, "and", x, "with" or a comma when one of
  the names records on its own, so "Simon & Garfunkel" stays one), lists each artist once by their own name with
  Navidrome's picture and id, and puts the exact name first. The Hub's catalog `search3` does the same with joined
  album artists (`creditNames` in `hub/src/credits.ts`, `hub/src/librarySearch.ts`, `hub/src/subsonicCatalog.ts`, #227).
- **Fix: the owl's hands.** Its three finger feathers splayed into a clump that looked broken, most of all round the
  mic. Each wing now ends in one soft rounded wing tip with three short scalloped feathers along its edge
  (`wingTip` in `parts.tsx`, #225).

## 0.32.0
- **An owl and a T. rex.** The thirteenth and fourteenth critters, drawn cute. The owlet is drawn like a sticker: a round
  brown head with two short pointed tufts, a big cream face, huge round dark eyes with big shines, a little yellow
  beak and pink cheeks, on a plump figure with orange talons and a fan of tail feathers. Its wings are its arms:
  bare, with three feathers like little fingers for each hand. The baby T. rex is leaf green with a big soft snout, a pale yellow chin, freckles,
  little brow ridges and a wide grin with two tiny teeth, on big strong legs with three-clawed feet and a thick tail
  sweeping along the ground with a row of little plates. Its arms are short and thin: a plump upper arm, a skinny
  forearm bending at the elbow and two little claws on each hand, and they still reach every instrument. Both play
  all nine acts (the Driver too) as a boy or a girl, with the holiday hats and themed outfits; the owl's tufts tuck
  under the cowboy hat like the bears' ears (`OwlFace` and `TrexFace` in `faces.tsx`, `FIGURES.owl` and
  `FIGURES.trex` in `bodies.tsx`, a figure's `fore` and `hand` in `Arm`, `parts.tsx`, #224).
- **Wrong lyrics? Pick the right ones.** Under the lyrics in Now Playing, **Wrong lyrics?** lists the other LRCLIB
  entries for the song (name, artist, album, length and the first lines, the likeliest first), searches LRCLIB with
  your own words, takes lyrics you paste in (plain, or LRC with times for karaoke), or marks the song as having
  none. The pick is remembered for the song, wins over Navidrome's and LRCLIB's, and replaces the Hub's shared copy
  so the rest of the house gets it too. **Forget my pick** looks the song up again (`LyricsFixer.tsx`,
  `setLyricsPick` in `lib/lyrics.ts`, #218).
- **Fix: lyrics from another song.** The LRCLIB lookup now needs the artist to match when LRCLIB names one, only
  takes a name that contains the title when it is most of it ("Zoo York" no longer passes for "Zoo"), takes a
  near name only at the song's length, and turns down an entry with the same name but a much different length
  (more than a minute and over a third off), which is another song rather than a live take (#218).
- **The Hub answers browsing, search and covers from its catalog (phase 3 of replacing Navidrome).** Off by default:
  **Hub answers browsing, search and covers** under Settings → Server → Music catalog. For devices that reach
  Navidrome through the Hub, `getArtists`, `getArtist`, `getAlbum`, `getSong`, `getGenres`, `getSongsByGenre`,
  `getRandomSongs`, `search3`, `getAlbumList2` and album/song `getCoverArt` come from the catalog with Navidrome's
  ids, so streaming, stars, playlists and scrobbles still go to Navidrome. Migration 31 adds ReplayGain, album artist
  id and first-seen columns and re-reads every file once (`hub/src/subsonicCatalog.ts`, #220).
- **Tidy genres keep Christmas.** Occasion genres (Christmas, Christmas Country, Holiday Pop, Halloween …) stay after
  the tidy genre instead of being dropped, and a one-time restore puts back the ones earlier tidies removed, from the
  undo log, as one undoable save ("Put Christmas genres back"). The genre review proposes exact spellings ("Rap;Hip-Hop"
  becomes "Rap; Hip-Hop"), and the Music catalog card lists songs Navidrome has that no file matched (#219).
- **Critters: heads sit on their necks.** Every species' head is lowered by `NECK_DROP` so the chin tucks over the
  collar instead of floating over the shoulders, in every act (#221).
- **Critters: no chest lines on the girls.** The folds drawn across the chest (`Bust`) are gone for every species and
  act; the girls keep their lashes, bows and skirts (#223).

## 0.31.0
- **A panda critter.** The twelfth species: a cute panda cub with a round cream-white head and fluffy cheeks,
  round black ears, black teardrop patches round big shiny brown eyes, a little black button nose, rosy cheeks and a
  wide smile, on a chubby figure with black arms and legs, round black feet with pale toe pads and a white puff of a
  tail. It plays all nine acts (the Driver too) as a boy or a girl; the girl's lashes are pale so they show against
  the eye patches. The ears tuck under the cowboy hat and the hazmat hood like the bears' and show round every
  holiday hat (`PandaFace` in `faces.tsx`, `FIGURES.panda` in `bodies.tsx`, #216).
- **Critters: the elephant gets a wide smile.** Its trunk now comes down between the eyes and sweeps out to the left,
  tip up, over a wide smile that shows either side of it, and the bigger singing mouth opens just right of centre
  under the trunk's bend (#215).
- **Fix: the Driver act had no necks, and the turtle no shell.** The act skipped `Legs`, where each species draws its
  neck, shell, legs and tail, so heads floated over the car. They're now drawn behind the car's tub, with the tail
  hidden (#214).

## 0.30.0
- **An elephant, a tiger and a lion.** Three more critters, drawn cute. The elephant calf is soft grey with big
  round pink-lined ears that stay out either side of every hat (even the cowboy hat) and flap to the beat, and a
  short trunk that curls up to one side so the smile shows under it. The tiger cub is orange with bold stripes, white
  cheeks, green eyes and a pink nose, and a striped tail. The lion cub has a russet mane round its head (the girl is a
  lioness, without one) and a tufted tail. All three play every act as a boy or a girl; the hazmat hood hides the
  ears, trunk and mane (`ElephantFace`, `TigerFace`, `LionFace` in `faces.tsx`; `FIGURES.elephant` and the big-cat
  figure `FIGURES.tiger` / `FIGURES.lion` in `bodies.tsx`, #211).
- **A Driver act for the critters.** The ninth act: the critter at the wheel of a little open-top car (an original
  design: round headlights, a grinning chrome grille, a racing stripe and a WAVE plate), coming down a long road at
  sunset, singing along. It swerves from side to side in time with the music, the wheel turning under the steering
  hand, bounces on its springs with the bass, and the free hand changes move every bar (tapping the wheel, waving
  out of the car, raising the roof, drumming the door). The road bends and rushes by faster as the band gets louder,
  the headlights pulse on the beat and the scarf flaps in the wind. Flourish: the car hops off the road, hand in
  the air. Paused, the car idles at the roadside. A flat driving cap (a bow for girls), a white racing tee and a
  scarf; the car, cap and lights take the skin's colours, and the holiday hats and theme outfits go on as usual.
  Every species plays it (`Drive.tsx`, #212).
- **A turtle critter.** The eighth species: a cute sea-green turtle with a soft mint muzzle, big blue eyes, rosy
  cheeks and a wide smile, on stumpy clawed legs with a little pointed tail. Its high domed shell is
  drawn behind the top, so the rim shows round every act's outfit and the instruments and arms go in front of it.
  The plain round head takes every hat, the headphones, the visor and the respirator. It plays all eight acts as a
  boy or a girl (`TurtleFace` in `faces.tsx`, `FIGURES.turtle` in `bodies.tsx`, #208).
- **Popular songs on artist pages.** Above the albums, an artist page lists the artist's best-known songs that are in
  your library, Spotify-style: five, with **Show more** for up to ten, plus **Play** and **Shuffle**. The order is
  Deezer's top tracks for the artist, each found on your Navidrome or Plex; Navidrome's Last.fm top songs fill in when
  Deezer has nothing. The section is left out when none of them are in the library (`src/lib/popularSongs.ts`,
  `src/components/PopularSongs.tsx`, #207).
- **Library care reads the music catalog (phase 2 of replacing Navidrome).** Once the catalog matches at least 95%
  of Navidrome's songs, the tag editor, Edit artist, Merge, Library care, the genre review and Delete album take their
  album and song lists from `catalog_songs` instead of Navidrome's API: no sign-ins, no 429s. Before that, and for
  albums the catalog doesn't know yet, they ask Navidrome as before. Tag saves, undos and deletes update the catalog at
  once (`hub/src/libraryAdmin.ts`, #209).
- **Fix: the music catalog matched only 88 songs to Navidrome.** Subsonic's song paths are made up unless a player has
  Report Real Path on, so the catalog now takes real paths from Navidrome's own API and falls back to
  artist/album/file when the music folders sit at different levels. Sound-alike analysis gets the real paths too
  (#210).

## 0.29.0
- **The Hub's own music catalog (phase 1 of replacing Navidrome).** The Hub walks the music folder and keeps one row
  per file in `catalog_songs` (migration 30, `hub/src/catalog.ts`): tags, length, bit rate, format, MusicBrainz ids
  and the matching Navidrome ids, by path. Only new or changed files are read with ffprobe; a walk that finds less
  than half the known files removes nothing. Scans 30 s after start, hourly, after every Navidrome scan and on
  **Scan now**. `GET /api/admin/catalog`, `POST /api/admin/catalog/scan` and **Settings → Server → Music catalog**.
  Sound-alike analysis now takes the library index's Navidrome listing instead of listing Navidrome itself. Navidrome
  still streams (#204).
- **A moose critter.** The seventh species: a dark brown moose with a big droopy muzzle, a fur bell under the chin,
  long ears and wide palmate antlers, on long legs with pale stockings and cloven hooves. It plays all eight acts as a
  boy or a girl. The antlers sit behind the head, so the cowboy hat, the beanie, the headphones and the holiday hats
  go on between them; the hazmat hood hides them (`MooseFace` in `faces.tsx`, `FIGURES.moose` in `bodies.tsx`, #206).

## 0.28.0
- **Browse by genre and decade.** A new **Browse** page shows a tile for every decade and every genre in the library,
  with sub-genres on each genre. Open one for its artists and albums, narrow it with sub-genre and decade chips, and
  Shuffle or Play it (`src/views/Browse.tsx`, `src/lib/browse.ts`). Navidrome and Plex albums now carry their genres
  (OpenSubsonic `genres`, Plex `Genre`).
- **Filters on Albums and Artists.** Genre (with sub-genres), decade or a year range, and sort (A to Z, artist,
  newest, oldest, recently added; artists by name or most albums). They stay while you open an album and come back
  (`src/components/BrowseFilters.tsx`, `src/store/browse.ts`).
- **Sub-genres.** The Hub's tidy genres keep the sub-genre next to the genre instead of dropping it: "Trap" becomes
  "Rap; Hip-Hop; Trap" and "Deep House" "Electronic; Deep House", written into the file tags so Navidrome lists both.
  The defaults have about 140 sub-genres (`DEFAULT_SUBGENRES` in `hub/src/genres.ts`); saved rules get them once.
  Settings → Server → Genres shows and edits each genre's sub-genres, and a new rule can keep its genre as a sub-genre
  (#202).
- **Critters: drumsticks land on the drum heads.** The sticks are drawn from the species' real hand to the snare's
  head and the crash instead of a fixed offset, and the floor-tom stroke turns the wrist so the stick lands on the
  tom's head. The flying-V's fretboard and headstock get a light outline so they show against dark fur (#201).

## 0.27.3
- **Critters bend at the elbow.** Every arm is split at an elbow halfway along its curve; acts move the forearm and
  hand with `bend()` and leave the upper arm still (`src/components/critters/arm.ts`). The guitar and banjo fret and
  strum from the elbow instead of sliding the whole arm off the shoulder, and the synth, DJ, rapper, drummer,
  theremin and accordion get bent-elbow playing patterns on the beat (#199).

## 0.27.2
- **Fixed: "Navidrome refused the admin login saved on the Hub" during Library care scans.** The Hub signed in to
  Navidrome's API for every page of songs or batch of albums, and Navidrome's sign-in limit (`AuthRequestLimit`,
  5 per 20 s by default) answered the rest with 429, which the Hub reported as a bad admin login. The Hub now keeps
  one Navidrome admin session for 10 minutes (`hub/src/routes/navidrome.ts`), and a 429 gets its own message.

## 0.27.1
- **Fixed: "Wrong username or password" on Navidrome through the Hub.** With **Send everyone through the Hub** on,
  a device's Navidrome source points at the Hub (`<hub>/nd/<id>`) and signs in with a login the Hub made for that
  device (`<name>~<device id>`). Settings → Sources still showed editable login fields, so typing your own
  Navidrome login there broke it. A Hub Navidrome source now shows no login fields and a fixed address, and the
  relay's error says what the address is when it gets a plain Navidrome login.

## 0.27.0
- **Audiobooks and podcasts: sorting, speed, skip and chapters.** Audiobooks sort by recently added, recently
  played, title, author, series, published or length, with Not started / In progress / Finished chips. Podcasts sort
  by new episodes, recently added, recently played, title, author or most episodes, and a show's episodes by newest,
  oldest, unplayed first or length. Now Playing gets a speed picker (remembered per book and per show), −15 / +30
  buttons, a chapter list, and a sleep timer for the end of the chapter (`lib/shelfSort.ts`, `lib/spoken.ts`).
- **Pick up where you left off.** The queue and the spot in the song come back, paused, after the app restarts
  (`lib/resume.ts`).
- **Streaming quality.** Separate Original / High / Normal / Data saver settings for Wi-Fi and mobile data; Navidrome
  converts on the fly (`lib/streamQuality.ts`).
- **daylist.** A Made for you mix for this time of day, named after it ("daylist: chill Saturday night"). The app
  sends its time zone with `GET /api/mixes?tz=`; older apps get no daylist (`hub/src/mixes.ts`).
- **Wake-up alarm.** Settings → Playback. On Android an alarm clock alarm opens the app over the lock screen
  (`AlarmBridge.kt`, new permissions: exact alarms, boot completed); on computers the app must be running.
- **Ask the DJ out loud.** A microphone in the DJ chat and DJ mode, using the device's speech recognition or, set
  under Settings → AI DJ → Voice requests, Whisper or OpenAI through `POST /api/dj/listen`. Adds the microphone
  permission on Android and the usage text on Mac and iOS.
- **Home Assistant can hand playback off between your devices.** `POST /api/ha/players/:id/handoff` with
  `{ "to": "Kitchen" }` moves the queue, song and spot to the other device and pauses this one, like "play this
  queue from here" in Devices. Handy from a dashboard button or a macro pad.

## 0.26.1
- **"Fix 1550 titles" no longer ends in a 504.** Library care sent a big fix as one request of up to 1000 songs.
  The Hub rewrites each file, so that ran for minutes and the proxy in front of the Hub gave up with "504 error"
  (the Hub kept writing, but the app never heard how far it got). Fixes are now sent 25 songs at a time with a
  running count, the Hub writes four files at once, a part that fails is tried once more, and all the parts stay
  one Save under Tag edits. If the Hub stops answering, the songs already fixed drop off the list and Fix carries
  on from there. "Split joined artists" and other big saves in Unmatched songs work the same way.
- **Numbered titles finds songs in seconds.** Instead of opening every album's files through the Hub, it reads
  Navidrome's own list of songs (`GET /api/admin/tags/numbered`), so it no longer waits on every album being read.
  An older Hub falls back to reading albums, in smaller requests.
- **Unmatched songs reads albums in smaller requests, three at once**, so a big library doesn't time out either.

## 0.26.0
- **"Lil Wayne;Drake" splits into two artists.** Navidrome only splits artists on "; " with a space, so a credit
  written "Lil Wayne;Drake" showed up as one artist. The Hub now writes it as "Lil Wayne; Drake" in new downloads
  before Navidrome scans them, and Wavelength reads both spellings (and " / ") the same when it picks the main
  artist for charts, Release Radar, For You and kid-safe checks.
- **Library care → Unmatched songs** (Hub admins). Lists the songs whose tags keep Navidrome from filing them
  right: joined artists, "maybe joined" ones like "Lil Wayne,Drake", and songs with no artist, album artist, album,
  title, genre, year or track number. Filter by problem and search, split every joined credit in one click, set a
  tag on many ticked songs at once, or edit one song's tags in place. Everything can be undone under Tag edits
  (`docs/USER-GUIDE.md#library-care`).

## 0.25.2
- **Theme outfits fit the critters better.** The Nuclear respirator covers every mouth and sits below the green
  alien's eyes; the Retro shades and Laser visor are big enough for the aliens and bears; the Neon glow spans the
  aliens' heads; the cowboy hat sits down over every head instead of clipping; and the Editor palettes' glasses are gone.
- **Song previews play again.** In Discover, a preview button no longer greys out because Deezer was busy or a
  lookup hiccuped: lookups are paced under Deezer's limit, wait it out when it's hit, and a failed one can be
  clicked again. A clip link that has run out (charts, the Weekly Mix and Release Radar keep them for hours) is
  swapped for a fresh one when it plays, instead of failing.

## 0.25.1
- **Girl critters get their own outfits.** Each act has a skirt or dress for the girls: a cowgirl denim fringe
  skirt, a pleated mini for the rapper, a pink tutu with the rocker's leather jacket, a sailor dress for the drummer,
  a space dress for the theremin, and dresses for the DJ, synth and accordion.
- **The strumming arm is back over the guitar** in the Rocker and Country acts; only the arm on the neck goes
  behind it.

## 0.25.0
- **Accessibility.** Names for icon-only buttons and the seek and volume sliders, the song menu from the keyboard
  (Shift+F10, arrows, Esc), and **Settings → Themes → Motion** to calm animations, critters and visualizers
  (`docs/USER-GUIDE.md#accessibility`).
- **Translate lyrics.** With the AI DJ set up, the lyrics can show a translation under each line, or the lines in
  Latin letters for Japanese, Korean, Chinese and other scripts. Made once per song for the whole house
  (`docs/USER-GUIDE.md#translate-lyrics`).
- **Listening now.** The sidebar shows what the others in the house are playing, with Play and (for a party) Join.
  Turn it off for yourself in Settings → Account; kids are hidden unless they turn it on, and then only their
  grown-ups see them (`docs/USER-GUIDE.md#whos-listening`).
- **Home Assistant.** See what your devices are playing and control them from Home Assistant, with a token from
  Settings → Account → Home Assistant and the setup in `docs/HOME-ASSISTANT.md`.
- **Guest Jam.** In a listening party, **Make a guest link**: friends scan the QR code, search your library in their
  phone's browser and add songs to your queue, no app or account (`docs/USER-GUIDE.md#guest-jam`).
- **Don't play this.** From any song's menu, keep a song or a whole artist out of song radio, Sounds like this,
  Smart Shuffle, DJ mode and your Made for you mixes. Undo it there or in Settings → Playback → Don't play. Synced
  with a Hub, which leaves them out of your mixes too (`docs/USER-GUIDE.md#dont-play-this`).
- **Smart Shuffle.** Press shuffle twice: your songs shuffled, with a song you might like after every three
  (`docs/USER-GUIDE.md#smart-shuffle`).
- **Mini player, tray icon and hotkeys** in the desktop apps: a small always-on-top player, play/pause/next/previous
  from the tray or menu bar, Ctrl+Alt+Space / → / ← from any app, and optionally keep playing in the tray when the
  window is closed (`docs/USER-GUIDE.md#mini-player-tray-and-hotkeys`).
- **The Mac app and the Linux AppImage update themselves,** like the Windows and Android apps. Releases now carry
  a `Wavelength_X.Y.Z_universal.app.tar.gz` for that (`docs/RELEASING.md#in-app-updates`).
- **One menu for every song.** Right-click a song (press and hold on a phone) for Play next, Add to queue, Add to
  playlist, Song radio, Sounds like this, Go to artist or album, Share and Copy song name
  (`docs/USER-GUIDE.md#the-song-menu`).
- **A tidier sidebar.** Pages are grouped under **Your library** and **Explore**, and each section folds.
- **Playlist folders and pins.** Put Wavelength playlists in folders, pin favorites to the top, and sort the Playlists
  page by recently changed, name or size. Synced with a Hub (`docs/USER-GUIDE.md#playlist-folders-and-pins`).
- **Calmer Now Playing.** Add to playlist, Lyrics, Cast and DJ mode up front, everything else under **More**.
- **Settings search, and Hub settings set apart.** Find any setting by name; the Hub admin tabs come after your own.
- **Search forgives typos** (with a Hub). "kendirck", "beyonse", "acdc" and "gods plan" find Kendrick Lamar,
  Beyoncé, AC/DC and God's Plan, words are found by their start ("kend lam"), and the artists you play come first.
  When a word only matched with a typo, Search says *Showing results for …*. The Hub searches its copy of the
  Navidrome library in one go instead of each device asking Navidrome (`docs/HUB.md#search`).
- **Search by lyrics** (with a Hub). Type a line you remember ("started from the bottom") and Search lists the songs
  with it under *In the lyrics*, with the line.
- **Lyrics are shared through the Hub.** Lyrics one device found show up on the others straight away, and LRCLIB is
  asked once per song for the whole house (`docs/HUB.md#lyrics`).
- **The Hub stays quick during sound-alike analysis.** Measuring each song used to hold up every other Hub request
  for half a second to two seconds at a time, for hours during the first analysis. It now runs in its own thread.
- **Server load** in Settings → Server (Hub admins): CPU, memory, how long requests wait for the Hub, and how many
  songs and lyrics the Hub keeps (`docs/HUB.md#load`).
- **Recent searches.** The Search page shows your last few searches until you type, with **Clear**.
- **Less lag with Now Playing open.** The player bar no longer animates behind the full-screen Now Playing, the
  screen no longer redraws everything (the critter's whole drawing included) each time the clock ticks, and the
  critter and visualizers slow to 20 frames a second while paused. In a test with the CPU slowed to phone speed,
  Now Playing with a critter went from 64% to 49% of the main thread while playing and from 51% to 21% paused.
- **The Rapper's mic no longer hides the face,** and the Theremin's hands line up with it again. The mic is held
  low beside the chin, and the pitch antenna moved out past the head, with the hands on the antenna and over the loop.
- **Girl critters.** A **Boy** / **Girl** switch in **Settings → Playback → Critters** gives every critter
  eyelashes and a bow in your skin's accent colour in place of the act's hat (the beanie stays, with the bow on it)
  (`docs/USER-GUIDE.md#critters`).
- **The Rapper's cap is gone.** The rapper plays bare-headed now, for boys and girls alike.
- **No crash when a feature is switched on or off.** Home's Jump back in, Share, Sounds like this, the smart
  playlist editor and Radio's station rows could crash their page ("Rendered more hooks than during the previous
  render") when an admin changed a feature switch or the Hub connected while the page was open.
- **Developers:** `npm run lint` (Biome, for the app and the Hub) and `npm run e2e` (Playwright smoke tests of the
  browser build) now run on every pull request (`docs/DEVELOPMENT.md#tests-and-checks`).
- **The artist link on an album page always works.** It used to do nothing when the album's artist id wasn't
  one in the library's artist list. It now finds the artist by name too, else opens the artist on that server by
  its id, else their Deezer releases.
- **Track numbers in song titles.** Titles like "04 - God's Plan", left by renaming tools that copy the file name
  into the title tag, show as "God's Plan" and lyrics are looked up without the number, so more songs get synced
  lyrics. **Library care → Numbered titles** (Hub admins) finds them across the library and fixes the files, and
  **Edit tags** can fix one album (`docs/USER-GUIDE.md#library-care`).

## 0.24.6
- **Music keeps playing through dead zones.** Lose signal for 10 or 15 minutes (a tunnel, the countryside, a car
  park) and the phone no longer goes quiet. While you listen, Wavelength saves about 20 minutes of your queue ahead
  and about 20 minutes of songs like the one playing. When the signal drops, the queue carries on from those files.
  If it runs out, the similar songs, your smart offline shelves and your other downloads stand in. Then it picks your
  queue back up, from the spot where the song was cut off, once the signal is back. The mini player says
  *No signal · saved songs* meanwhile. On by default, including on mobile data, because that's where dead zones
  are. Change it in **Settings → Downloads → Dead zones**. Windows and Android app (`docs/USER-GUIDE.md#dead-zones`).
- **New faces for the critters.** All six are redrawn like vinyl toys: big round heads with soft shading, a dark
  outline, big eyes with coloured irises and highlights, and a rim of stage light along one edge in your skin's
  colours. The raccoon has fluffy cheeks and white brow patches, the shark a friendlier toothy grin, the aliens
  glossy eyes, and the bears big muzzles. Shades and glasses still sit over their eyes in every
  act.
- **New bodies for the critters.** Each species has its own body in the same style: the raccoon a short chunky top,
  stout furry legs, big feet and a big striped tail; the bears a puffy jacket and baggy trousers, mid-stride; the
  shark one slim torpedo down to a crescent tail, with its fins for arms; the aliens spindly arms and legs over a
  hover glow. Heads are a little smaller so the bodies show, and arms hang from each body's shoulders. The act
  outfits are fitted to them next (`docs/CRITTERS-ROADMAP.md`, phase 4).
- **Outfit changes from the review.** The rapper wears the cap backwards and no shades, the rocker loses the
  mohawk (the shark's fin shows again there), and the theremin player wears a space-age tunic with a belt, a
  glowing buckle and a planet badge instead of a space suit.
- **The critters' faces act while they sing.** Instead of one oval that opens and shuts, each critter's mouth now
  takes six shapes (closed, *ah*, *oh*, *ee*, lips pressed for *m*/*b*/*p*, and an open grin when belting). With
  synced lyrics the shapes follow each syllable of the line; without them they follow a rough guess from the
  voice. The brows lift on a crescendo or a long held note, the eyes squint on high notes, and they blink now and
  then on the beat. Species touches: the shark sings with top and bottom rows of teeth, the raccoon's whiskers
  twitch and its lip curls on big drum hits, the alien's antennae glow brighter with a high voice, the aliens'
  eye shines widen on loud notes, and the bears' ears flick. First step of the critter art plan in
  `docs/CRITTERS-ROADMAP.md`.
- **The critters keep time.** They now find the song's tempo from the beats they hear and stay on it, so the head
  bob, a side-to-side sway, the tail and the ears (which now bounce on the beat) are steady instead of jumping on
  every kick, and the guitar and banjo hands strum in time. When a new song starts, or in an instrumental break
  between sung lines, each act shows off with its own flourish: a banjo spin, a DJ double-scratch with a hand in
  the air, shades pushed up, a windmill strum, a drum fill, a theremin swoop, a synth glissando or a long squeeze
  of the accordion. Critters, stands and props cast soft shadows on the floor.
- **DJ mode no longer stops after about ten songs.** A mix has no song limit, but when the DJ took longer to find the
  next segment than the last songs took to play (a slow Hub or music server, or a phone in your pocket), the new songs
  were added behind a stopped player and the music went quiet. They now start playing as soon as they arrive. Finding
  the next segment also keeps trying every 30 seconds instead of waiting for the next song, gives up on a request that
  hangs, and a short first segment can fall back on an **Encore** too.

## 0.24.5
- **DJ Trash Panda only plays when you ask.** Playing your own music, like a couple of songs from an album in your
  Library, could bring the DJ in: the Talking DJ talked over any music every few songs, and DJ mode kept running
  when the album held songs the station had queued. Now the DJ only talks over music it played for you (the AI DJ
  chat, or DJ mode started from the raccoon button), and starting your own song, album or playlist anywhere ends
  DJ mode and stops the DJ mid-sentence. **Play next** and **Add to queue** still keep DJ mode going.

## 0.24.4
- **US spelling.** Labels and messages use US English: **Your favorites**, **Forgotten favorites**, **Favorites (kept
  offline)**, **Gray alien**, the mouth tuner's **Center**, "analyzed", "canceled", "customized".
- **Easier to change what the DJ calls you.** **What the DJ calls you** (Settings → Playback → Talking DJ) now shows
  even with Talk between songs off, since DJ mode's intros use it too, and the DJ mode panel has the same box.
- **DJ mode turns off when you play something else.** Since 0.24.3, clicking a song in your library didn't stop DJ
  mode when that list happened to include songs the station had played, so DJ Trash Panda kept talking over your own
  music. Starting a new queue (a song, album or playlist) now always ends DJ mode; Play next and Add to queue don't.

## 0.24.3
- **DJ mode really keeps going.** The station no longer switches itself off when the song playing isn't one it
  queued (a song you added with Play next, or a copy of a song a source handed back): it only steps aside when you
  play something else entirely. As a last resort, when nothing new can be found, it replays its earlier songs
  (**Encore**) instead of stopping.
- **Up next in Now Playing.** The queue under the controls now scrolls through every song left, has a **Played** tab,
  folds away with an arrow (folded at first on phones, where it used to be hidden), and in DJ mode says the DJ adds
  more before the songs run out.

## 0.24.2
- **DJ mode keeps going.** When the next segment has none of its songs in your library (often Top hits), the
  station moves on to the one after instead of asking for the same one again and going quiet when the queue ran out.
  When none has anything, it carries on with **More like <artist>**, songs from your library like the one playing.
  The next segment is asked for with three songs to go, not two.
- **DJ Trash Panda talks between songs in DJ mode.** With **The DJ talks between songs** on in the panel, he says a
  line every few songs (Settings → Playback → Talking DJ → Every), not only at segment changes, without having to
  turn on the Talking DJ setting too. Lines are written earlier (75 s before the song ends) and wait up to 30 s into
  the song, so a slow local model isn't skipped. **Hub:** update it for this if **Talking AI DJ** is off in Features.
- **Mix it up does something you can see.** DJ mode's **Mix it up** starts at a random segment instead of always
  Your favourites (so it no longer looks the same as that button), is styled as a button rather than a selected
  chip, and the panel says it's picking songs and writing the intro while it works, with the buttons dimmed.

## 0.24.1
- **The DJ's first line uses the Hub's voice.** Starting DJ mode no longer reads the first intro in the device's
  voice (Windows' default) before switching to Kokoro or OpenAI: lines wait for the Hub to say which voice it has.
- **DJ mode on phones.** The DJ panel opens as a sheet over the bottom of the screen, above Now Playing (it used to
  open behind it), and with nothing playing a **DJ mode** bar above the tabs starts it.
- **Kokoro on Android.** The Hub's voice plays on phones: the DJ's audio is unlocked by your tap and plays through the
  player's own audio, instead of staying silent because the WebView blocks sound that doesn't start from a tap.

## 0.24.0
- **Families.** One Hub for several households: under **Settings → Users → Families** the Hub admin makes families,
  puts people in them, picks **managers**, and decides per family whether its managers may register people, look
  after its kids (bedtimes, limits, the family's own grown-up PIN) and set its own keys. Only the admin sees these
  settings; managers get **Settings → My family** with just what's allowed. Hub servers can be kept to some families.
- **Shared keys on the Hub.** The AI DJ's keys, tour dates, Last.fm (no more Docker variables needed), fanart.tv and
  the Discord application ID can be set for the whole Hub or per family, and a family's own wins. Keys from the Hub
  win over ones typed on a device.
- **Who's listening?** The button with your initial in the sidebar switches to anyone in your family with their
  switching PIN (Settings → Account), even if they never signed in on that device. Kids always need a PIN.
- **Fix joined artist credits.** An artist like "Lil Baby;Jeremih" (several artists joined with ";" in the tags)
  can now be edited: **Edit artist** no longer stops at "Navidrome has no albums for this artist" but finds the albums
  their songs are on, starts **Change to** as the first artist, and offers "Lil Baby", "Lil Baby feat. Jeremih" or
  "Lil Baby & Jeremih". Appears On also finds songs credited to such a joined name.

## 0.23.1
- **More songs find lyrics.** Titles tagged like YouTube uploads ("Adele - Hello (Official Music Video)" by
  "AdeleVEVO") are read as Hello by Adele, and when LRCLIB has nothing, plain lyrics come from lyrics.ovh.
- **Clearer lyrics misses.** "No lyrics found" now says what was searched for, and when the lyrics services can't be
  reached it says so with **Try again**. Lookups give up after 10 seconds instead of spinning.
- **Settings tabs fit.** The Settings tab row no longer overflows with stray scrollbars. On narrow windows and phones,
  every tab row scrolls sideways with faded edges, works with the mouse wheel, and keeps the selected tab in view.

## 0.23.0
- **Discover shows chart movement.** Each song has **▲3**, **▼2**, **NEW** or **=** under its rank (compared with
  about a week ago) and **5 wks** for weeks in a row on the chart. With a Hub the whole house shares one history
  (`POST /api/discover/positions`); without one each device keeps its own.
- **Faster "Checking your library…".** Signed in to a Hub with the Navidrome scan login, the Hub matches the whole
  chart against the library in one go instead of each device searching song by song (`POST /api/discover/match`).
  Plex and other servers are still checked on the device.
- **For you** tab in every Discover genre (with a Hub): the genre's chart, only songs close to what you play, with
  why ("You play Drake", "You follow SZA", "Like Drake").
- **Don't have / Have filters** in Discover, so a chart becomes a shopping list.
- **More on each chart song:** the artist's name opens their page (or their Deezer releases), and on hover
  **Song radio** and **Follow**. **×** marks a song Not interested and hides it from Discover everywhere, with Undo;
  the list syncs between your devices.
- **Get all missing runs in the background**, with a progress bar and Stop, and keeps going if you leave Discover.
  It asks in the bar instead of a pop-up, and rows remember Queued or Requested when you come back.
- **New from artists you follow** at the top of every Discover genre (with a Hub and follows), with a link to the
  full Release Radar.
- **Alternative genre** in Discover: RadioWave's Alternative Rock 100 and Apple Music's most played alternative and
  indie songs.
- **Hub:** update the Hub too for chart movement, the faster library check and For you; the app falls back to the
  old behaviour with an older Hub.

## 0.22.0
- **DJ mode shows what you're missing.** Each segment lists the songs it wanted that aren't in your library (Top hits
  checks the chart's top 50), with **Get** / **Request** for each and **Get all**.
- **DJ Trash Panda knows your playlists.** In DJ mode, pick one of your playlists and the DJ builds the station on
  it: some of its songs plus more like them. In the DJ chat, ask for "something like my Gym playlist".
- **DJ mode asks first.** The raccoon button opens a picker (Mix it up, a segment, a playlist, or type a request)
  instead of starting music straight away.
- **Fixed: pressing Throwbacks in DJ mode played Top hits.** Throwbacks come from months of listening; with less
  than that, the DJ fell through to the next segment. A segment you press now plays that segment (for Throwbacks,
  the AI picks older songs that fit your taste) or says why it can't.
- **Blended Kokoro voices.** Type a blend like `af_bella(2)+af_sky(1)` under **Settings → AI DJ → Voice** to make a
  new voice; it shows up in everyone's picker.
- **A louder DJ.** The DJ's voice is louder by default, with a **DJ loudness** slider (up to 250%) in the DJ mode
  panel and in **Settings → Playback → Talking DJ**.

## 0.21.0
- **The AI DJ can run on your own Ollama server.** Under **Settings → AI DJ → Ollama**, point the Hub at Ollama and
  pick a model from its list. Run the whole DJ on it for free, or keep the chat on Claude and let Ollama write the
  talking DJ's lines and DJ mode's intros. With a free ollama.com key the Hub searches the web for it too.
- **DJ mode.** Press the raccoon in the player and DJ Trash Panda runs a station for you: your favourites, new
  finds, throwbacks and top hits in segments, each introduced in the DJ's voice. Tap a segment to jump to it, or
  type what you want ("90s house", "chill for cooking") to change course. Songs come from your Made for you mixes
  and the charts, so the AI only writes the intros (and picks songs for requests). Turn it on under **Settings →
  Features → DJ mode**.
- **Fixed: lyrics showing "Instrumental" for songs with words, or not found at all.** LRCLIB often files
  instrumental and karaoke uploads under the song's own name, and the first one found used to win. Now every
  lookup is pooled and an entry with words wins. Lookups also leave off version notes ("- 2011 Remaster",
  "- Radio Edit", "(Live)"), search bands like Simon & Garfunkel by their whole name before the first artist, and
  finish with a free-text search. If LRCLIB can't be reached, the song is tried again later instead of staying
  blank for the session. Synced lyrics for the critters' mouths come through the same lookup.

## 0.20.0
- **Better voices for the talking DJ.** Admins can pick who reads the DJ's lines under **Settings → AI DJ →
  Talking DJ voice**: each device's own voice as before, **Kokoro** (free natural voices in a container next to the
  Hub), or **OpenAI** (the most expressive, acting out the hype, laid back or trivia style; about $15 per million
  characters, counted toward the AI DJ limits). Everyone can pick their voice in **Settings → Playback → Talking DJ**.
  If the Hub's voice fails, the device reads the line instead.

## 0.19.1
- **Fixed: the page crashed ("l is not a function") while chatting with the AI DJ.** Scrolling the chat to
  the newest reply handed React a Promise in current WebView2/Chromium, which React then tried to call. A new test
  keeps effects from returning anything but a cleanup.

## 0.19.0
- **The AI DJ can search the web.** Ask for today's top hits, or paste a festival or DJ setlist and say "build me
  an EDM mix from this": the DJ reads the songs off the page, plays or saves the ones you have and can request the
  rest. Off until an admin turns on **AI DJ web search** under **Settings → Features** (kids have their own
  switch, off); the cap on searches per step is under **Settings → AI DJ → Web**. Searches ($10 per 1,000 at Anthropic) count toward everyone's limits.
- **Meet DJ Trash Panda.** The AI DJ is now a rave raccoon in headphones and shades, next to each reply and bopping
  while he works.
- **iPhone and iPad app (TestFlight).** The app builds for iOS, with background audio, the iOS keychain and
  local-network access. Releases build it and send it to TestFlight once the Apple secrets are added
  (docs/IOS.md).
- **Bit-perfect output on Windows.** Settings → Playback can send songs straight to the sound card in WASAPI
  exclusive mode at their own sample rate and bit depth, decoded by the app itself (FLAC, ALAC, WAV, AIFF, MP3,
  AAC, Vorbis), with the format shown as it plays.
- **Discord status.** The desktop app can show "Listening to" the current song on your Discord profile
  (Settings → Playback), cleared on pause. Talks to the Discord app on the same computer; no extra services.
- **Public share links.** Share a playlist, album, song or artist with anyone as a web page (song names and
  "play it on…" links, never the music), for a week or for good; see and take them down in Settings → Account.
- **Music videos.** Now Playing offers the song's official video when the Hub's yt-dlp finds one, in a
  no-cookie YouTube player; the music pauses and picks up again afterwards. Off for kids by default.
- **Sing mode.** A **Sing** button in Now Playing turns the lead vocal down (adjustable) and opens the lyrics,
  for karaoke at home.
- **Artist bios, song credits and tour dates.** Artist pages get an About section (Wikipedia story, members,
  where and when they started, links) and Now Playing gets **Credits** (writers, producers, players, from
  MusicBrainz). With a Ticketmaster key or Bandsintown app ID saved on the Hub, artist pages list upcoming shows.
- **Talking DJ.** The AI DJ can now speak between songs, with the music ducked under it: every Nth song, in a
  laid back, hype or trivia style, read by the device's own voice (Settings → Playback). Admins switch it on in
  Settings → Features; each line counts against the AI DJ allowance.
- **Cast to speakers.** A new speaker button finds Chromecasts, Google/Nest speakers and DLNA/UPnP renderers on
  your Wi-Fi and moves playback there, with the queue, seeking, volume and scrobbling still run from Wavelength.
  Desktop and Android.
- **Tune the critters' mouths.** A **Tune mouth** button beside the critter (and **Settings → Playback → Critter
  mouths**, with a live critter) opens a tuner with a live graph of what the voice detector hears against what
  the mouth does. Sliders for sensitivity, how centred the voice must be, noise rejection, the voice range, drum
  hits, lyrics timing (for every song, or nudged for the song playing and remembered), syllable length, and how
  fast and wide the mouth moves. Synced with a Hub. See the [user guide](docs/USER-GUIDE.md#critters).
- **AutoMix.** **Settings → Playback → AutoMix** blends songs like a DJ: no fade inside an album, 8-beat
  beat-matched blends between songs at close tempos (with sound-alike analysis on the Hub), and longer fades
  for calm songs. Crossfades now use equal-power curves. See the [user guide](docs/USER-GUIDE.md#automix).
- **Sounds like this.** With **Sound-alike analysis** on (Hub admins, Settings → Features), the Hub measures
  how every song sounds (tempo, key, energy, timbre) with ffmpeg, no AI model needed. Now Playing gets
  **Sounds like this** and **Journey to…**, and smart playlists get mood and tempo rules. See the
  [user guide](docs/USER-GUIDE.md#sounds-like-this-and-sonic-journeys). **Hub:** `/api/sonic/…`.
- **Home and Made for you mixes.** With a Hub, Home has **Jump back in** and fresh mixes every day: On Repeat,
  Daily Mix 1–4, Discover Weekly, Forgotten favourites and Time Capsule, each with the songs your library has.
  **Blend** mixes your taste with someone in the house (both have to say yes). See the
  [user guide](docs/USER-GUIDE.md#home-and-made-for-you-mixes). **Hub:** `/api/mixes`, `/api/blend…`.
- **Mac and Linux apps.** Each release now has a universal Mac `.dmg` (Apple silicon and Intel) and a Linux
  AppImage and `.deb`. Passwords go in the macOS Keychain or the Secret Service (GNOME Keyring, KWallet).
  They don't update themselves yet.
- **Smart offline.** **Settings → Downloads → Smart offline** keeps your ♥ songs, your mixes and what you've
  played lately on the device by itself, on Wi-Fi, under a size cap, and deletes what drops off. See the
  [user guide](docs/USER-GUIDE.md#smart-offline).
- **Feature switches (Hub admins).** **Settings → Features** turns each newer feature on or off for the
  household and separately for kid profiles. **Hub:** `GET/PUT /api/admin/features`, and `GET /api/me` now
  says which features are on (see [docs/HUB.md](docs/HUB.md#feature-switches)).

## 0.18.1
- **The newest release banner no longer shows another artist's release.** Deezer often has several artists with
  the same name (a dozen "Drake"s), and the artist page took the first one Deezer listed, so Drake's banner could
  show a 2013 compilation by a small same-name upload. Wavelength now checks which same-name artist has the
  albums in your library (else the one with the most fans), hides the banner when it isn't sure, and **Browse
  releases** says when it isn't sure and lists the other artists with that name. Following by name, Release
  Radar's "artists you play", Library Care's missing albums, song radio and the AI DJ pick the same-name artist
  with the most fans too.

## 0.18.0
- **Critters sing along better.** Checked against real songs with the vocals separated out: with synced
  lyrics, mouths now catch most of the singing in a busy mix (72% and 62% of sung moments in two test songs,
  up from 53% and 19%) without opening in the instrumental parts. Mono songs used to make the mouth open for
  any instrument; with synced lyrics they now mouth along with each line's words instead.
- **AI DJ.** A chat in the app that knows your library: ask for a playlist, a mood or "more like this" and it
  searches, plays, queues and saves playlists for you; ask which albums you're missing and it compares the
  artist's discography with your library and requests the ones you pick. It runs on the Hub with your AI
  provider's API key (Anthropic Claude: Opus 5.5 by default, Sonnet 5.5 or Haiku 5.5), which never leaves the
  Hub. **Settings → AI DJ** (admins) holds the key, model, effort and prices, counts every person's tokens and
  estimated spend, and sets monthly limits per person and for the household. Off until an admin turns it on for
  the Hub and for each account; kids stay off unless turned on, and then get family-friendly picks only. See
  [AI-DJ.md](docs/AI-DJ.md) for the setup guide.
- **Browse an artist's releases from your library.** Artist pages have a **Browse releases** button with the
  artist's whole Deezer discography (the same page as Downloads → Deezer, with E / C badges and Clean only).
  Releases you already have say **✓ In library**, and **Not in library** hides them, so it's easy to see what's
  left to get. Downloads → Deezer artist pages mark them the same way.
- **Newest release banner.** Under the artist's name: **New release** (the last 6 weeks) or **Latest release**,
  with a preview, **Get** or **Request** when you don't have it, and **Coming soon** when Deezer lists an
  announced release. Kid profiles see the newest release they may have, and the explicit releases, songs and
  related artists on Deezer artist pages are now hidden for them as everywhere else.
  See the [user guide](docs/USER-GUIDE.md#browse-an-artists-releases).
- **Critter makeover.** A design pass over all 48 critter and act pairs:
  - The shark no longer has legs: it has a tail end with two fins, and its tail fin rests on the ground. Its
    dorsal fin tucks under hats instead of poking out beside them, and it shows its teeth when it sings.
  - Both aliens are slimmer: narrower heads and bodies, and the grey's head tapers to a proper pointed chin.
    Hats, headphones, hoods, shades and visors are refitted to their heads, so the rapper's shades cover the
    grey's eyes and hats sit on top of its head.
  - The dark blob or box under every critter's chin is now a soft shadow that follows the chin, and the bears
    lose the dark band under the muzzle.
  - The country act plays a five-string banjo instead of an acoustic guitar.
  - The theremin player's pitch hand plays by the antenna instead of resting on its chin, the accordion act's
    legs match the critter (they were black for everyone but the bears), the drummer's neckline shows the
    critter's own chest, and the shark's tail goes behind the campfire.
- **Playlist covers.** Give any playlist your own picture: press **Change cover** on a Wavelength, Navidrome,
  Plex or household playlist, then pick one of the album covers in it, upload a picture or paste an image link.
  Wavelength crops it square. Signed in to a Hub, the cover is kept there and shows on all your devices
  (Windows, Android, Android Auto and the browser); with no Hub it stays on that device. **Use the automatic
  cover** goes back to the default. See the [user guide](docs/USER-GUIDE.md#playlist-covers).
- **Better automatic covers.** A Wavelength playlist's mosaic now shows its first four different *albums*, so
  four songs from one album no longer fill all four squares, and uses the Hub's cover art when an admin changed
  it. Household playlists get the same mosaic.
- **Hub:** new `playlist_covers` table and `GET/PUT/DELETE /api/playlist-covers` (see
  [docs/HUB.md](docs/HUB.md#playlist-covers)).

## 0.17.10
Fixes from a bug sweep (the full list is in the PR):
- **Kid profiles:** Discover no longer shows kids explicit chart songs that aren't in the library, or plays their
  previews; a song stays hidden until Deezer says it's clean. A kid device the Hub signs out stays locked until a
  grown-up signs in again, instead of opening with no kid filters. Shuffle on a kid profile no longer always starts
  on the same song. **Hub:** the kid backstop now catches "feat." songs on albums the library check marked explicit.
- **Playback:** a song that won't load no longer stops the music: Wavelength says so and moves on to the next song
  (it stops after 3 in a row). The message now shows on phones and in Now Playing too. One broken song no longer
  turns off the EQ, visualizer, crossfade and gapless for the rest of the session. Pause, seek and the sleep timer
  now stop the old song during a crossfade too.
- **Crashes:** an error in Now Playing, the player bar or the queue shows a short note instead of blanking the app,
  and any other error shows the error page with **Reload app**.
- **Back:** opening the queue gets its own Back step, Back after deleting an album goes to the right page, and Back
  no longer stops working after about 30 pages.
- **Listening party:** a guest who taps Play sends the songs to play next for everyone, instead of playing them only
  on their device, out of step.
- **Downloads:** saving for offline refuses a server's error reply instead of saving it as a song, gives up on a
  stalled download, and cleans up half-downloaded files. **Hub:** if deemix can't be reached just as a clean
  version starts, the Hub keeps trying to put deemix's folder name back, and holds other downloads until it has,
  so they don't land in a "(Clean)" folder.
- An album whose server was removed from this device says so instead of loading for ever, and Search stops
  spinning when you clear the box.
- **Critters sing with the voice, not the beat.** Their mouths now listen for the lead vocal: sound in the voice
  range that sits in the centre of the mix and is tonal, ignoring drum hits and guitars panned to the sides.
  When a song has synced lyrics (Navidrome or LRCLIB, as in the Lyrics panel) they also keep their mouths shut
  through intros, solos and gaps, and on streams the app can't read they mouth along in time with each line's
  words. See the [user guide](docs/USER-GUIDE.md#critters).

## 0.17.9
- **Any critter, any act.** Pick who plays and what they play separately: the raccoon, shark, alien, grey
  alien and black or brown bear can each be a **DJ**, **Country** picker, **Rapper**, **Rocker**,
  **Drummer**, **Theremin** player, **Synth** player or **Accordion** player (48 combinations). Now Playing has
  **Switch critter** and a new **Switch act** button, and **Settings → Playback** has a Critters row and an Act
  row. Your current pick carries over. See the [user guide](docs/USER-GUIDE.md#critters).
- **Critters sing along.** Every critter's mouth now opens and closes with the vocals, not just the rapper's,
  and follows the singing more closely than before.

## 0.17.8
- **A grey alien and a bear join the critters** in Now Playing. The **grey alien** is the classic big-headed
  grey with huge black eyes, playing a synth in a crop circle under its saucer's tractor beam: the keys light
  up with the music and the beam brightens with the bass. The **bear** squeezes an accordion by a campfire in
  the pines, in a beanie and sweater: the bellows pump with the bass, the fire flares and fireflies blink.
  Pick a **black bear** or a **brown bear**. Like the others they bob, blink, yawn and dress for your theme.
  See the [user guide](docs/USER-GUIDE.md#critters).

## 0.17.7
- **A shark and an alien join the raccoons** in Now Playing. The **drummer shark** plays a drum kit on the sea
  floor: snare on the beat, cymbal crashes on sharp hits, a thumping kick, bubbles that rise faster with the
  bass. The **theremin alien** plays a theremin on the moon under a hovering UFO: its hands follow the bass
  and the highs and glowing sound waves pour off the antenna. Both bob, blink, yawn and dress for your theme
  like the raccoons (hazmat suits, visors, glow sticks, shades, holiday hats).
- The **Switch raccoon** button is now **Switch critter**, the visualizer is called **Critters**, and
  **Settings → Playback** lists all six under **Critters**. Your current pick carries over. See the
  [user guide](docs/USER-GUIDE.md#critters).
- **Fixed: blank window after Back from a song's album (0.17.4).** Opening an album from Now Playing's song title,
  or from a song list's album link, and then pressing Back left the Windows app blank until it was restarted. The
  album page now leaves cleanly. (Newer WebView2 hands back a value from the scroll to the song that React took
  for a cleanup function.)

## 0.17.6
- **Appears On, like Spotify.** An artist's page now lists, under their albums, the albums by other artists in
  your Navidrome library that they're featured on: songs crediting them as a track artist ("Drake feat. Future")
  or in the title ("Life Is Good (feat. Future)"). Click one to open the album. Kid profiles and the Explicit /
  Clean version setting filter it like everywhere else.

## 0.17.5
- **Find the clean version on Deezer.** In Downloads → Deezer, songs and albums show **E** or **C**, and the
  discography grid says **Explicit** or **Clean** under each album, so two *I Am Not A Human Being* cards with the
  same cover can be told apart. Album names show on two lines instead of being cut off. **Clean only** (search
  results and artist pages) hides explicit ones; it starts on for people who prefer clean versions and on kid
  profiles.

## 0.17.4
- **Go to the song, artist or album from Now Playing.** The album name, song title and artist on Now Playing open
  the album, the album scrolled to the song (which flashes), and the artist's page. In **Up next**, a song's artist
  opens their page. Now Playing closes, and Back returns to the page you were on before it.
- **Artist and album links in song lists.** In search results, playlists, favorites, history and other song lists,
  the artist and album under a song's title open their pages; the album opens scrolled to the song.
- **Fixed: album and artist pages coming up empty through the Hub** ("Expected ':' after property name in JSON",
  *Straight Outta Cashville*, Travis Scott). With Navidrome going through the Hub, the Hub passed on Navidrome's
  size for a zipped reply but sent it unzipped, so mid-sized replies (an album's songs, an artist's albums) were cut
  off part way, and the leftover bytes could spoil the next reply on the same connection, so other lists came and
  went. The Hub now leaves the size off replies it unzipped. **Update your Hub** for this fix.
- An album whose parts Navidrome lists separately still shows the parts that load if one doesn't, with a note.
- An artist page whose server couldn't list the albums now says why instead of staying empty, and a broken reply
  names the server address it came from.

## 0.17.3
- **Select several albums or artists, like Plex.** **Albums**, **Artists** and an artist's page have **Select**;
  you can also start from the round tick on a card, or Ctrl/⌘- or Shift-click. Shift-click ticks a range. The
  bar plays, shuffles or queues everything ticked.
- **Merge albums and artists (Hub admins).** Tick two or more and press **Merge**: the first one ticked is the
  target (its card says so), and the others merge into it. Albums take the target's album, album artist and year
  tags; artists are renamed to the target in every song. One save, so **Settings → Server → Tag edits** can undo it.
- **Fixed: albums split into an Explicit and a Clean album (0.17.2).** When Navidrome lists part of an album on its
  own (*One Day* from *Underground Luxury*, downloaded separately), that part's "clean" tag made Wavelength show it
  as a separate clean version, with an Explicit / Clean switch, and split the album in two. A tag only says whether
  the songs in it are explicit, so now only "(Clean)", "(Edited)" or "(Censored)" in the name makes a clean version.
  Same-named albums are one album again, and the album page shows and plays all the parts on a server together, in
  track order. Your files and folders weren't changed, by 0.17.2 or by this.
- Kid-safe flags no longer treat a song's explicit tag as another version: a flag on an album covers all its songs
  again, whatever their tags. Flags 0.17.2 saved for "the explicit version" now cover the song or album as a whole.
  Clean songs on an explicit album are still fine for kids on their own (search, playlists).

## 0.17.2
- **See what deemix is doing.** Downloads → deemix queue shows each download's place in line, songs done and
  failed, and deemix's reason for each failed song, with **Cancel**, **Retry** and **Clear finished**. Inbox
  requests (Release Radar's automatic ones too) show a progress bar and reasons.
- **Fixed: downloads getting stuck.** When deemix hangs on a download, the Hub now notices after 15 minutes and
  says so, instead of clean versions waiting silently for up to 12 hours each. Clean versions waiting for deemix
  are kept across Hub restarts (they used to vanish and stay at "Sent to deemix" for ever); ones already lost now
  say **Not in deemix's queue any more** and can be sent again. Retrying a failed download works even while deemix
  still lists the failed one. A request deemix lost is marked failed with the reason after an hour.
- **Hub:** `GET /api/downloads/deemix/progress`, `POST /api/downloads/deemix/queue/:uuid/cancel|retry`,
  `POST /api/downloads/deemix/queue/clear`, `DELETE /api/downloads/deemix/clean`; requests carry `progress`.
- **Fixed: marking the clean version for kids marked the explicit one.** On an album with the Explicit / Clean
  switch, the **Kids** button saved the flag under the explicit album's name even with the clean version on
  screen, and song flags ignored which album a song was on. So **OK for kids** on a clean song or album let the
  explicit one through. Flags now say which version they're for (untagged, explicit, clean, or every version) and
  only apply to it, in the app, the Hub's Navidrome relay and Release Radar's auto-get. The **Kids** menu adds
  **Hide every version**.
- **Repair on update:** the Hub moves every existing **OK for kids** on a song or album to the clean version, so
  explicit music is hidden from kids again (re-mark anything explicit you meant to allow). Song **Hide** flags keep
  covering every version. Library-check results saved for a "(Clean)" album, which were Deezer's explicit album's,
  are dropped. Recorded in the audit log as `kids.flagsRepaired`.
- **Fixed: some "clean versions" weren't clean.** The library check took any Deezer album with the same name that
  Deezer didn't call explicit. It now takes only an album Deezer marks as edited, or one with no explicit songs
  that has the explicit album's explicit songs on it. **Inbox → Clean versions → Check clean versions** (admins)
  re-checks the ones found before, drops the wrong ones, and lists downloaded clean copies with songs tagged
  explicit or that came from a wrong album, to **Delete selected** or **Hide selected from kids**.
- A song tagged explicit in its file is hidden from kids even inside a "(Clean)" album, on the Hub's relay too; a
  song on a "(Clean)" album or tagged clean is no longer held to the explicit album's library check there.
- The library check skips clean copies, and same-named albums tagged explicit on one server and clean on another
  stay two versions instead of being merged.
- Release Radar's auto-get for kids skips releases from artists or albums an admin hid from kids, not just explicit ones.
- **Delete several albums at once:** admins get **Select** on Albums, to tick albums and **Delete selected** (to the
  Hub's trash for 30 days, after a confirmation).
- **Hub:** `content_flags.version`; `GET /api/flags` returns `version`, `POST /api/admin/flags` takes it.

## 0.17.1
- **Fixed:** clean versions downloaded next to an explicit album (*Loud (Clean)*) showed the **E** badge and
  were hidden from kid profiles. They took the explicit album's library-check result, because "(Clean)" is
  dropped when matching names. An album with "(Clean)", "(Edited)" or "(Censored)" in its title now counts as
  clean unless its own file tags say explicit, and **Hide from kids** on the explicit album no longer hides the
  clean one. Nothing was written to your files or the Hub; the badges are right again after updating.

## 0.17.0
- **Android Auto:** browse your playlists, recently added albums, favorites and radio stations in the car, search,
  and ask the Assistant to play something on Wavelength.
- **Home-screen widget (Android):** what's playing, with previous, play/pause and next.
- **Push notifications while the app is closed,** through the free ntfy app: an admin picks the ntfy server
  (Settings → Server), then each person turns it on under Settings → Account → Notifications.
- **Hub:** `/api/me/push…` and `/api/admin/push`.
- **CI:** an Android build with the Kotlin unit tests on pull requests that touch `src-tauri`.
- **Two-step sign-in:** turn on an authenticator app code for your Hub password (Settings → Account), with 10
  recovery codes. Admins can reset it, and the Users tab shows which admins don't have it.
- **Parents for kid profiles:** give a kid parents (Settings → Users) and their requests go to them too, to
  approve in **Inbox → To approve**, along with a **weekly listening report** every Monday.
- **Your month in music:** on the 1st, a notification with last month's minutes, songs and top artist, opening Rewind.
- **More than one person on a device:** add everyone on a shared TV or tablet and switch between them in a tap;
  each can ask for a PIN, and leaving a kid profile needs the grown-up PIN.
- **Household playlists** (Playlists → Household): playlists the whole house adds to, showing who added what.
- **Hub:** `/api/me/2fa…`, `DELETE /api/admin/users/:id/2fa`, `PUT /api/admin/users/:id/guardians`,
  `/api/household/playlists…`; `GET /api/me` adds `twoFactor` and `kids`; notification kinds `report` and `rewind`.
- **Get the song you hear on the radio:** Now Playing shows **Queue from library** when you have it, or **Get this
  song** (Get or Request) when you don't, whenever the station's title names a song.
- **Stations for you** (Radio): popular stations in the genres you have the most music in.
- **Smart playlists** (Playlists): rules like "Rap; Hip-Hop, rated 4+, not played in 90 days" that pick songs from
  your Navidrome library each time you play them. **Save copy** puts today's songs on your server. Synced with a Hub.
- **Library care** (Albums → Library care): **Duplicates** lists albums your server has more than once (editions
  folded in), and admins can send the extra copies to the trash; **Missing albums** lists studio albums by your
  top artists that you don't have, with Get / Request.
- **Weekly genre check:** the Hub reviews the library's genres once a week and notifies admins when there's
  something new to tidy.
- **Hub:** `POST /api/admin/genres/check`; notification kind `library`.
- **Release Radar: Coming soon.** Releases the artists you follow have announced but not put out yet show under
  **Coming soon**, and you get a notification when one is announced.
- **Get new releases automatically.** Turn on **Auto** for an artist in **Manage** and the Hub fetches each new
  release as it comes out: straight to deemix if you can download, otherwise as a request for approval.
- **Weekly Mix:** about 30 songs every Friday from new releases by the artists you follow and artists you might
  like, with previews, Get / Request, and full songs for the ones already in your library.
- **Song radio:** on Now Playing, and **Artist radio** on a library artist's page, fills the queue with songs
  from your library like the one playing (Deezer's related artists and top songs).
- **Scrobbling** (with a Hub): connect ListenBrainz or Last.fm in Settings → Account and the Hub sends your
  plays from every device. Last.fm needs `WAVELENGTH_LASTFM_KEY` / `_SECRET` on the Hub.
- **Hub:** `PATCH /api/radar/follows/:id`, `GET /api/radar/mix`, `upcoming` in `GET /api/radar`,
  `GET`/`POST`/`DELETE /api/me/scrobble[/:service]`. Migration 17.
- **Synced lyrics** in Now Playing (**Lyrics** chip): the line being sung lights up, tap a line to jump there,
  big text on TVs. From your Navidrome server's own lyrics when it has them, else LRCLIB. Kid profiles see
  strong words hidden.
- **Sleep timer** (**Now Playing → Sleep**): 15 minutes to 1½ hours with a gentle fade-out, or the end of this song.
- **Gapless playback:** the next song is loaded ahead and starts the moment this one ends.
- **Crossfade** (Settings → Playback, 1–12 s) and **ReplayGain** volume levelling (Track or Album, from your
  files' loudness tags via Navidrome). Both sync between devices with a Hub.
- **Faster start:** Settings, Discover, SUB/WAVE, Downloads, Inbox, Rewind, the tag editors and playlist import
  now load the first time you open them, which halves the code parsed at startup (noticeable on TV boxes).
- **Builds:** React 19 and zustand 5; the app has unit tests (`npm test`, Vitest).
- **Security:** the app now has a Content-Security-Policy (so does its browser version on the Hub): text from
  the internet can't run scripts inside Wavelength.
- **Hub:** the Docker image checks yt-dlp against its published checksum, rebuilds every week for a fresh
  yt-dlp and Alpine fixes, and is scanned for known vulnerabilities.
- **Builds:** Vite 8 (fixes the dev-server advisories in `npm audit`); release builds use Node 22.
- **Security:** updates are checked before they install. The app compares each downloaded file with the
  SHA-256 GitHub publishes for it, and, once a signing key is set up, also requires a valid signature
  (docs/RELEASING.md "Update signing").
- **Security:** yt-dlp downloads in the app only take web links and pass them after `--`, so a link can't
  turn into a yt-dlp option; a custom yt-dlp path must be an actual yt-dlp program.
- **Security:** updated the Rust TLS libraries (rustls, rustls-webpki, webpki-roots) and tokio for published
  advisories.
- **Builds:** a new `App` check runs TypeScript, Rust tests, clippy and dependency audits on every pull
  request and weekly; Dependabot keeps npm, Cargo, Docker and Actions dependencies current.
- **Android:** music no longer stops when the screen locks. Playback also carries on into the next song with
  the screen off, holds the CPU and Wi-Fi awake while streaming, and pauses when headphones are unplugged.
  docs/USER-GUIDE.md "Listening with the screen off" covers phones whose battery saver still closes the app.
- **Builds:** TypeScript 7, qrcode-generator 2, and updated Rust crates (base64, minisign-verify, windows-sys,
  sha2) and GitHub Actions. The Hub image is on Node 24 LTS.

## 0.16.0
- **Follow artists and build your own Release Radar** (with a Hub). Press **Follow** on any artist page (your
  library's or Deezer's) and their new albums, EPs and singles from the last 6 weeks show up under **Discover →
  New releases → Release Radar → Following**, with preview and Get / Request. The Hub checks the artists you
  follow about every 12 hours and sends a notification when one of them puts something out. **Manage** lists
  who you follow and lets you follow an artist by name.
- **Artists you might like:** suggestions of who to follow, from Deezer's related artists for the ones you follow
  and play, plus artists you play a lot but don't follow yet. Follow them in one click, or **×** to stop seeing
  one. The old radar is still there as **Artists you play**, and is all you see without a Hub.
- Release Radar now hides explicit releases from kid profiles.
- **Hub:** `/api/radar`, `/api/radar/follows`, `/api/radar/check`, `/api/radar/suggestions`; notification kind
  `radar`. See [docs/RELEASE-RADAR.md](docs/RELEASE-RADAR.md).
- **Song titles on more radio stations.** Most Shoutcast and Icecast stations send the current song inside
  their stream even when they have no now-playing page; Wavelength now reads it, so stations that only
  showed their name show the song. In a browser this goes through your Hub. Stations that send no titles at
  all (many DJ mix and "sessions" streams) still show only their name.
- **Hub:** `GET /api/radio/now-playing?url=`.
- **Clean versions get their own folder** (with deemix on the Hub): **Get clean version**, Inbox → Clean
  versions and approved clean requests save to a "… (Clean)" folder instead of colliding with the explicit
  copy (where deemix skipped every song as already downloaded), and the songs' album tag gets " (Clean)" so the
  two versions stay separate albums. The Hub waits until deemix is free, then switches deemix's album folder name
  for that one album.
- **Hub:** `POST`/`GET /api/downloads/deemix/clean`.
- **Fixed:** the Apple Music chart showed "Skipped: 403" in Discover. Apple moved its chart feed to a new
  address; Wavelength and the Hub now read it from there.

## 0.15.0
- **Tidy genres** (Hub admins): one genre per kind of music, so "Hip Hop", "Trap" and "Rap/Hip Hop" all become
  **Rap; Hip-Hop**, "Dance Pop" becomes **Pop**, and "EDM", "House" and "Techno" become **Electronic**. New downloads
  get the tidy genre before Navidrome adds them. **Settings → Server → Genres → Review library genres** lists the
  albums already in your library whose genre isn't tidy: apply one, the ones you tick, or all, with **Undo**. Genres
  the Hub doesn't know yet are listed so you can pick what each becomes. The rules can be edited there.
- **Hub:** `/api/admin/genres`, `/api/admin/genres/review`, `/api/admin/genres/apply`, `/api/admin/genres/keep`.
- **Fixed:** Favorites showed "getFavorites is not a function" when a SUB/WAVE server with a login (or Hub
  admin access) was connected. Favorites lists Navidrome stars only again; SUB/WAVE likes are already in them.
- **Discover loads from your Hub.** With a Hub, every device reads the charts from the Hub's copy instead of
  pulling Billboard, Deezer, iHeart, Spotify and the rest each time Discover opens. The Hub fetches the charts
  people use again every 30 minutes, and when a chart service is down or rate limiting (Deezer often is) you
  get the last copy that worked, marked with when it's from, instead of an error. Without a Hub, the app
  keeps the last copy that loaded and shows that when a refresh fails. **Refresh** now really fetches again.
- **New releases:** Spotify's **New Music Friday** (read from Spotify's public page, no Spotify account
  needed) and Deezer's **Radar Weekly** are now the first two lists, alongside iHeart's Newly Released and
  Fresh Picks.
- **Genre lists from Deezer's editors:** **Fresh Rap** (updated daily) under Rap / Hip-Hop, **Fresh Pop**
  under Pop, **Fresh R&B** under R&B and **Metal Radar** under Rock. New Dance now leads EDM / Dance.
- The genre chips are reordered: Rap / Hip-Hop, EDM / Dance, Rock and Country come right after New releases.
- If you picked your own charts for a genre in **Settings → Discover charts**, that genre keeps your pick; tick
  the new lists there, or **Reset to defaults**.
- **Hub:** `GET /api/discover/fetch?url=` (the chart cache).

## 0.14.0
- **Clean versions list:** **Inbox → Clean versions** lists every explicit album the library check found a
  clean version of on Deezer. Preview each one, download it on its own, or tick several (or **Select all**)
  and **Download selected** / **Download all**. Each row shows Queued, Downloading, Downloaded or Failed, and
  albums already in your library or already sent are skipped. **Settings → Users → Kid-safe music** links to it.

## 0.13.1
- **Fixed:** 0.13.0 didn't start on Windows or Android. The notification icon setting in `tauri.conf.json`
  made the notification plugin fail to load; the icon is now set on each notification instead.

## 0.13.0
- **Notifications** (with a Hub): a request that's ready, turned down or failed, something shared with you,
  and (admins) a new request show up as Windows, Android or browser notifications while Wavelength isn't in
  front. On or off per device under **Settings → Account → Notifications**.
- **Hub:** migration 15 (`notifications`) and `GET /api/notifications`.
- **Soulseek** (with a Hub and slskd): a **Soulseek** tab in Downloads searches the network and shows results
  by folder, best first, with format, size and whether there's a wait; **Download** gets the album. Admins can
  fill a request from Soulseek with **Soulseek…** in the Inbox. Set up under **Settings → Downloads**.
- **Hub:** service kind `slskd`, `/api/slskd/*`, and `slskd` on request approvals.
- **Logins in the OS keychain:** on Windows and Android, your Hub sign-in, server passwords and tokens, the
  deemix ARL and the share password are kept in Windows Credential Manager or the Android Keystore instead of
  the app's own storage. Existing ones move there on first start; nothing to do.
- **Edit artist** (Hub admins): rename an artist, or merge two spellings, in every song on all their albums,
  and set a genre for all of them. Every change is listed before saving, and it can be undone.
- **Tag suggestions:** the artist, album artist and genre boxes in the tag editors suggest names already in
  your library.
- **Delete album** (Hub admins): the files go to a hidden trash folder and can be put back from **Settings →
  Server → Deleted albums** for 30 days.
- **Hub:** migration 14 (`trash`), `/api/admin/tags/albums`, `/api/admin/tags/values`,
  `DELETE /api/admin/library/album/:id`, `/api/admin/trash/*`.
- **Containers** (Hub admins, optional): **Settings → Server → Containers** starts, stops and restarts the
  household's other services and shows their logs, through a Docker socket proxy and only for the containers
  you name.
- **Hub:** `WAVELENGTH_DOCKER_URL`, `WAVELENGTH_DOCKER_CONTAINERS`, `/api/admin/docker/*`.
- **Listen together** (with a Hub): start a party from the new button by the volume; everyone who joins
  hears the same song at the same moment on their own device. Guests can add songs, and skip and pause if
  the host allows it.
- **Hub:** `/api/together/*` (in memory, long polling).
- **Devices** (with a Hub): the new button by the volume shows your other open devices and what they're
  playing. Control them, or move playback: **Continue there** sends what's playing here to that device at the
  same spot, **Play here** brings it back. Turn it off per device under Settings → Account.
- **Hub:** `/api/me/remote/*` (in memory, long polling).
- **Rewind** (History → Rewind, with a Hub): your year or month in music, with top artists, songs and
  albums, minutes, streaks and when you listen. Play it, save it as a playlist, or share it as a picture.
- **Hub:** migration 13 (`plays`, filled from existing history), `/api/me/rewind`, `/api/me/rewind/periods`.

## 0.12.0
- **Invite links** (admins): **Settings → Users → Invite someone** makes a one-time link (and QR code) for a
  role. The person opens it, or pastes it in the app under **Settings → Account → I have an invite**, and picks
  their own username and password.
- **Restore a backup** from **Settings → Server**: the Hub checks the file, restarts and swaps it in, and
  keeps the database it replaced.
- **Hub:** migration 12 (`invites`), `/api/admin/invites`, `/invite/:code`, `/auth/invite`,
  `POST /api/admin/restore`. The Hub exits with code 75 to restart after a restore.
- **Tag editor** (admins): **Edit tags** on a Navidrome album fixes its tags in the files, by hand or from a
  Deezer / MusicBrainz match, with **Undo** (and **Settings → Server → Tag edits** for older saves). Navidrome
  rescans afterwards.
- **Hub:** migration 11 (`tag_edits`), `/api/admin/tags/*`, and `WAVELENGTH_NAVIDROME_MUSIC_DIR`.
- **Import a playlist** (Playlists → Import) from a Deezer, Spotify or YouTube Music link, or a CSV, M3U or
  text file. Songs you have become a Wavelength playlist; **Get missing** / **Request missing** handles the rest.
- **Hub:** `POST /api/import/youtube`; `/api/fetch` also reads Spotify's public pages.
- **Your playlists are yours.** Wavelength playlists and play history are now kept per person on the Hub:
  they follow you to every device, and on a shared device everyone sees only their own. Playlists already on
  a device become the first person's to sign in there.
- **Hub:** migration 10 (`user_playlists`, `play_history`) and `/api/me/playlists`, `/api/me/history`.
- **Kids' Navidrome password stays on the Hub.** Kids' devices reach Navidrome through the Hub with a login of
  their own (per device, so signing a device out ends it). The Hub swaps in the real login, refuses account
  changes, and won't stream a kid anything explicit or flagged, even to another app. **Send everyone through
  the Hub** (Settings → Server → Navidrome accounts) does the same for everyone.
- **Explicit / Clean switch** on albums the library has in both versions, and **Settings → Playback →
  Explicit and clean versions** to prefer one (synced; kids always get clean).
- **Hub:** `/nd/:id/rest/:method` relay and `relay` setting on the `navidrome` server kind.
- **Change cover art** (admins). Album and artist pages get **Change cover** / **Change picture**: look the
  art up on Deezer, Apple Music and MusicBrainz's Cover Art Archive (plus fanart.tv with a key), upload a
  picture, or paste an image link. It's kept on the Hub and shows on every device and in the browser, in song
  lists, the player and Now Playing too. **Use the server's picture** undoes it. Your music files aren't
  changed.
- **Hub:** migration 9 (`artwork`), the `/api/artwork`, `/api/art/:file` and `/api/admin/artwork` routes, and
  `WAVELENGTH_FANART_KEY`. Pictures are stored in the data folder under `artwork/`.
- **Everyone gets their own Navidrome account.** Admins add Navidrome and its admin login under **Settings →
  Server → Navidrome accounts**, then **Make account** (or **Use their login**) per person. Their devices get
  their own Navidrome login when they sign in; the admin login never leaves the Hub.
- **Listening now** in Settings → Server: who's playing what, on which device.
- **Hub:** `navidrome` server kind, `/api/admin/services/:id/users/:userId/navidrome-account`,
  `/api/me/playing`, `/api/admin/listening`.
- **"Your song is ready."** Approved requests now go *Downloading* → *Adding to your library* → *Ready*, and
  a ready one lights up the Inbox with a **Play** button that finds it in your library.
- **Navidrome rescans after downloads.** Add a Navidrome admin login under **Settings → Server → Library
  updates** and the Hub starts a scan as soon as downloads finish (also **Scan now**).
- **Hub:** migration 8 (request download tracking), `/api/admin/library` routes.
- **Wavelength in a browser.** Open your Hub's address in any browser to use Wavelength there. It goes
  straight to signing in to that Hub. Deezer, the charts and Release Radar work through the Hub; offline
  downloads still need the app. The Hub's Docker image now includes the web build (build it from the repo
  root: `docker build -f hub/Dockerfile .`).
- **Settings → Server** (admins): Hub version and uptime, free space on the music and data disks, whether the
  music folder is writable, yt-dlp's version, household counts, and **Download backup**.
- **Hub:** `/api/admin/server`, `/api/admin/backup`, `/api/fetch`, and `WAVELENGTH_WEB_DIR`.
- **Library check for explicit music.** **Settings → Users → Kid-safe music → Check my library** looks each
  album up on Deezer and records on the Hub which albums and songs are explicit, so kid profiles and the
  **E** / **C** badges work for files without the explicit tag, and for Plex. Your files aren't changed. It
  skips albums already checked, so it can be stopped and run again for new albums.
- **Get clean version.** An explicit album whose clean version is on Deezer gets a **Get clean version** button
  (**Request clean version** without Autodownload).
- New downloads: tick **Explicit lyrics** under deemix **Settings → Tags** so deemix writes the tag.
- **Hub:** migration 7 (`ratings`) and the `/api/ratings`, `/api/admin/ratings` routes.
- **Kid profiles.** Kids get a shorter menu with bigger buttons (Home, Search, Discover, Albums, Artists,
  Favorites, Radio, Audiobooks, **Ask for music**, Inbox and **Me**), and no Settings.
- **Bedtime and a daily listening limit** per kid, set by an admin under **Settings → Users → Kid profiles**.
  At bedtime or when the day's minutes are used up, the music stops and a "Time for bed" screen covers the
  app. Listening adds up across all the kid's devices.
- **Grown-up PIN.** Set once for the household. It unlocks 30 more minutes on the bedtime screen, and it's
  needed to sign out of a kid profile (**Me → Sign out**).
- **Hub:** migration 6 (`kid_rules`, `listening`, `hub_settings`) and the `/api/me/kid`, `/api/me/listened`,
  `/api/kid/unlock`, `/api/admin/kids` and `/api/admin/kid-pin` routes.
- **Kid-safe music.** On a kid profile, anything marked explicit (from your files' tags through Navidrome, or
  from Deezer) is hidden everywhere: albums, artists, search, playlists, favorites, Discover, Release Radar and
  Deezer browsing, and the player won't play it. Admins get a **Kids** button on every song, album and artist
  to hide something from kids or mark something explicit as fine, and a **Kid-safe music** list under
  **Settings → Users**. Flags are kept on the Hub and apply on every kid's device.
- **E** and **C** badges on explicit and clean songs and albums.
- **Hub:** new `content_flags` table (migration 5) and `/api/flags`, `/api/admin/flags` routes.
- **Request music.** Signed in to a Hub without Autodownload, **Get** becomes **Request** in Downloads, Discover
  and Release Radar, and you can paste a YouTube, SoundCloud or Bandcamp link too. Admins approve in the new
  **Inbox → To approve**: the Hub downloads it with deemix or yt-dlp, or they mark it as already in the library
  or reject it with a reason. You see the answer in **Inbox → My requests**. Admins and people with
  Autodownload still download straight away.
- **Share with each other.** A **Share** button on playlists, albums, artists, radio stations, songs and your
  favorites sends them to one person on your Hub or to everyone, with a note. They show up in **Inbox → Shared
  with you**, where **Play** finds the songs in your own library and **Save as playlist** keeps them.
- **Inbox** in the sidebar (and the phone's Library tab) with a count of new shares, answers and requests to
  approve. See the [user guide](docs/USER-GUIDE.md#requesting-music).
- **Hub:** new `requests`, `shares` and `share_seen` tables (migration 4) and the `/api/requests`,
  `/api/admin/requests`, `/api/people` and `/api/shares` routes. Update the Hub container along with the app.

## 0.11.0
- **In-app updates (Windows and Android).** Wavelength checks GitHub for a newer release on launch and every
  6 hours, shows a banner, and lists it in the new **Settings → Updates** tab with the release notes.
  **Install update** downloads the right file and installs it: on Windows the setup exe runs with a progress bar
  and reopens Wavelength (the portable `Wavelength.exe` is swapped in place); on Android the APK goes to the
  system installer (allow **Install unknown apps** for Wavelength the first time). **Include pre-releases** is
  off by default. The first version with this has to be installed by hand; updates after it don't. See the
  [user guide](docs/USER-GUIDE.md#updates).

## 0.10.0
- **Three more raccoons** in Now Playing: a **country** raccoon (cowboy hat, acoustic guitar, taps his boot),
  a **rapper** raccoon (cap, shades, gold chain, raps into the mic while the speakers pump) and a **rocker**
  raccoon (mohawk, leather jacket, flying-V, headbangs in front of the amps). Switch with the **Switch
  raccoon** button on the raccoon visualizer or in **Settings → Playback → Now Playing visualizer**, which
  also picks the visualizer. Both choices sync through a Wavelength Hub.
- **Raccoons dress for your theme**: hazmat suits and respirators on Nuclear skins, laser visors on Lasers,
  glow sticks on Neon, 8-bit shades on Retro and coder glasses on Editor palettes, on top of the holiday hats.
  See the [user guide](docs/USER-GUIDE.md#raccoons).
- **Server logins on your Hub.** Admins can keep Plex, Audiobookshelf, SUB/WAVE, deemix and yt-dlp logins on
  the Wavelength Hub (Settings → Sources / Downloads → **Move to Hub**), so signed-in devices get them without
  typing them in. Pick who can use each server (everyone, admins only, or chosen people) and give someone
  their own Plex or Audiobookshelf login. Members and kids never get the SUB/WAVE admin login, and download
  logins only go to admins and people with Autodownload. Logins are encrypted on the Hub. Navidrome logins stay
  on each device. See [HUB.md](docs/HUB.md#server-logins).
- **Admin logins stay on the Hub.** SUB/WAVE DJ controls, deemix and yt-dlp now go through the Hub, so no
  device (admins' included) holds the SUB/WAVE admin login, the deemix ARL or a network-share login. The Hub
  runs yt-dlp itself and saves straight into its music folder, so YouTube downloads work from phones and
  Android TV too. Every download is in the Hub's activity log with who queued it.

## 0.9.0
- **Settings has tabs**: Sources, Playback, Downloads, Themes and Discover. **Edit charts** on Discover and
  the Settings link in Downloads open the right tab.
- **Themes tab**: skins grouped (Classic, Retro, Neon, Lasers, Nuclear, Editor palettes, Holidays, Accessibility), a search box,
  and a live preview: point at (or D-pad to) a card and the whole app shows it until you move away.
  **Random daily** picks a different skin every day. See the [user guide](docs/USER-GUIDE.md#skins-and-themes).
- **5 holiday skins**: Halloween, Thanksgiving, Christmas, July 4th and Valentine's Day (light). **Seasonal**
  mode switches to each one in the weeks around the holiday and back to your pick afterwards.
- **5 nuclear skins** (Themes → Nuclear): Reactor core (Cherenkov blue), Meltdown (molten orange), Radiation
  hazard (warning yellow and hazard tape), Fallout shelter (olive drab with a Geiger-green LCD) and Uranium glass
  (UV-green glow). See the [user guide](docs/USER-GUIDE.md#skins-and-themes).
- **5 more laser skins** (Themes → Lasers, which Laser grid has moved into): Laser show (RGB beams), Red laser,
  Green laser, Laser harp (violet light strings) and Laser tag (orange vs. cyan). All ten new skins are in the
  Random daily rotation.
- **10 more glow skins**: Laser grid in magenta, amber, green and violet (Lasers); Nuclear, Radium and Isotope
  (Nuclear); Neon diner, Neon lime and Neon ice (Neon). Reactor core is now labelled Cherenkov (reactor core).
- **DJ raccoon** visualizer in Now Playing: he wears your skin's colours (and a hat on holiday skins), bobs on
  the beat, scratches on sharp hits and yawns when paused. See the [user guide](docs/USER-GUIDE.md#dj-raccoon).
- **Edit your radio stations**: Radio → Your stations → **Edit** to reorder (arrows or drag), hide stations on
  this device, or delete a Navidrome station from the server (Navidrome admin accounts only). Favorites can
  be reordered too. See the [user guide](docs/USER-GUIDE.md#editing-your-radio-stations).
- **Wavelength Hub (Phase 1, server side).** A new optional server, `hub/`, shipped as a Docker image with an
  Unraid template: user accounts with roles (admin, member, kid), sign-in with a Hub password or tinyauth
  single sign-on (through Nginx Proxy Manager), TV-style pairing codes for devices, per-device sign-out,
  synced preferences and an audit log. Admin-only routes are refused for members and kids on the server, not
  just hidden. See [docs/HUB.md](docs/HUB.md) and the roadmap in
  [docs/USERS-AND-ADMIN.md](docs/USERS-AND-ADMIN.md).
- **Sign in to a Wavelength Hub** (Settings → Account): connect, set up a new Hub, sign in with a code and QR
  code (approve it from your phone with tinyauth or your Hub password) or with a password. Your theme, EQ, Now
  Playing scene, radio stations and Discover chart picks then follow you to every device; downloaded music
  keeps playing offline. Link your tinyauth account to a password account (from the app or the browser),
  change your password, and sign out lost devices. Admins get **Settings → Users**: add people, roles,
  Autodownload, passwords, tinyauth usernames, turn accounts off, sign devices out, and recent activity. See the
  [user guide](docs/USER-GUIDE.md#profiles-with-a-wavelength-hub).

## 0.8.0
- **Fix: Dracula, Monokai, Solarized, OLED black, High contrast, Sakura and Cyberpunk didn't work on Windows.**
  A missing closing brace in `styles.css` (lost in a merge) put those skins, and the equalizer's styles, inside
  the phone-width media query, so on a desktop-sized window the skin picker showed blank cards and picking
  them did nothing. They now apply and preview at every window size; the EQ pop-over is also back in place on desktop.
- **6 new neon skins** (Settings → Skin), on Windows, Android phones/tablets and Android TV: Outrun (chrome
  sunset over a laser grid), Laser grid (glowing cyan outlines on black), Acid rave (toxic lime and magenta),
  Miami nights (flamingo pink and teal), Blacklight UV (violet with highlighter yellow) and Electric (arc blue
  and violet). See the [user guide](docs/USER-GUIDE.md#skins).
- **Releases now include the Windows installer and Android APK automatically.** Publishing a release on
  GitHub runs a build that attaches `Wavelength_X.Y.Z_x64-setup.exe`, `Wavelength.exe` and the signed
  `Wavelength-X.Y.Z-android.apk`. See [RELEASING.md](docs/RELEASING.md#automated-builds-github-actions).

## 0.7.0
- **Fix: downloaded songs stopped after a moment on Android.** Offline songs now load fully before playing on
  Android (desktop is unchanged), so they play to the end, seek normally and drive the visualiser.
- **Now Playing visualizers**: tap the artwork in Now Playing to cycle through Halo, Oscilloscope, Starfield,
  Mirror spectrum and Pulse rings (and back to the cover). They react to the music, use your skin's colours, and
  your choice is remembered. See the [user guide](docs/USER-GUIDE.md#now-playing-visualizers).
- **8 new skins** (Settings → Skin): Dracula, Monokai, Solarized Dark, Solarized Light, OLED black (true black for
  OLED phone screens), High contrast (yellow on black, thick outlines, strong focus rings), Sakura (light) and Cyberpunk.
- **Equalizer**: 10 bands with a preamp, 13 presets (including Phone speaker and Podcasts & books) and a live
  response curve. Open it with **EQ** in the player bar or in Now Playing, or in Settings → Equalizer. See the
  [user guide](docs/USER-GUIDE.md#equalizer).

## 0.6.0
- **Browse Deezer by artist, album and playlist** (Downloads → Deezer): search now finds artists and playlists too. Artist pages
  show top songs, the full discography (albums, EPs, singles, compilations) and related artists, with
  **Get discography**. Album and playlist pages show the tracklist with 30-second previews, **Get album** / **Get playlist** and per-track **Get**.
  Artist pages also list public playlists the artist is on.
- **Pick your Discover charts**: Settings → Discover charts (or **Edit charts** on Discover) chooses which
  charts each genre shows and mixes. iHeartRadio, RadioWave and Deezer lists can be added to any genre.
- New [user guide](docs/USER-GUIDE.md) with screenshots for both.

## 0.5.0 — first public release

Everything below, plus project documentation (`docs/`), brand assets and an MIT license.

## 0.4.1
- **Android media session**: steering-wheel, Bluetooth, headset and lock-screen controls; song info and
  artwork on car stereos; media notification; foreground playback service so music keeps going with the screen off.

## 0.4.0
- SUB/WAVE: cancel songs in Up next (✕) and cancel the rest of an album/artist block.
- **Android TV**: launcher banner, D-pad navigation with focus rings, remote media keys, 32-bit ARM build.
- 10 more skins: Tokyo Night, Catppuccin, Gruvbox, Nord, Everforest, Kanagawa, Rosé Pine, iPod Classic, Aqua, Walkman.

## 0.3.x
- Discover rebuilt on live charts: Billboard, Apple Music, Deezer, RadioWave Monitor and iHeartRadio editors; Shazam removed.
- **New releases** with **Release Radar** (new albums from the artists you play).
- Retro skins v2 (colour artwork, accent colours) + Windows 95, MS-DOS, Synthwave sunset, Arcade, '70s groove.
- Android: edge-to-edge insets (tablets, car head units), compact layout for short screens.
- Android 17: local-network permission; clearer connection errors.

## 0.2.0
- Offline downloads for albums and playlists.
- Discover previews (30 s) and Deezer editors' EDM charts.
- SUB/WAVE likes list, compact phone On-air card.
- Retro skins: Vaporwave, Green/Amber CRT, Game Boy, C64.

## 0.1.x
- Unified catalog across Navidrome, Plex and Audiobookshelf; radio; SUB/WAVE tab with admin
  (DJ control, schedule editor, shows, stats); deemix + yt-dlp downloads; History; Favorites;
  Recently added; mixed-source playlists with Navidrome/Plex sync; phone layout; Android APK; Neon synth brand.
