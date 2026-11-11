import type { Station } from '../sources/types';

/**
 * Radio → Your stations: turn a server station's raw name into something a card can show.
 *
 * Navidrome stations only have a name, and people paste whatever the stream calls itself, so names look like
 * "Energy 93@181.FM (Euro EDM)(Dance/Techno)" or "KADA Cool (Contemporary) Ada, OK". We split that into
 * a clean title ("Energy 93"), the genres in brackets ("Euro EDM", "Dance", "Techno"), the network
 * ("181.FM") and anything left over ("Ada, OK"), and pick a genre family that sets the card's colour and
 * the "By genre" group.
 */

export type GenreFamily = 'dance' | 'hiphop' | 'rock' | 'country' | 'pop' | 'decades' | 'jazz' | 'chill' | 'classical' | 'talk' | 'world' | 'ai' | 'other';

export interface StationLabel {
  title: string;
  genres: string[];
  network?: string;
  place?: string;
  family: GenreFamily;
  /** One or two characters for the art tile when there's no logo: "90s", "E9", "KC". */
  mark: string;
}

/** Group headings for the families, in the order the groups show. */
export const FAMILY_NAMES: Record<GenreFamily, string> = {
  ai: 'AI radio',
  pop: 'Pop & hits',
  decades: 'Decades',
  rock: 'Rock & alternative',
  dance: 'Dance & electronic',
  hiphop: 'Hip-hop & R&B',
  country: 'Country',
  jazz: 'Jazz, soul & blues',
  chill: 'Chill & lounge',
  classical: 'Classical',
  world: 'World',
  talk: 'News & talk',
  other: 'Everything else',
};

// first match wins, so the more specific families go first ("Euro EDM" is dance, not pop)
const FAMILY_WORDS: [GenreFamily, RegExp][] = [
  ['ai', /\b(agentic|ai radio|sub\/?wave)\b/i],
  ['talk', /\b(news|talk|sports?|podcast)\b/i],
  ['dance', /\b(edm|dance|techno|house|trance|electro\w*|dubstep|drum ?(and|&|n) ?bass|dnb|club|deep dish)\b/i],
  ['hiphop', /\b(hip[ -]?hop|rap|r ?& ?b|rnb|urban|trap|power)\b/i],
  ['country', /\b(country|bluegrass|americana|big ?rig|bull)\b/i],
  ['rock', /\b(rock|alternative|alt|metal|punk|grunge|indie)\b/i],
  ['jazz', /\b(jazz|soul|blues|funk|motown)\b/i],
  ['chill', /\b(chill|lounge|ambient|lofi|lo-fi|relax\w*|smooth)\b/i],
  ['classical', /\b(classical|orchestra\w*|opera|baroque|symphon\w*)\b/i],
  ['world', /\b(latin\w*|reggae|k-?pop|afro\w*|bollywood|world)\b/i],
  ['decades', /\b(\d0'?s|oldies|classic hits|retro)\b/i],
  ['pop', /\b(pop|hits|top ?40|contemporary|mix|adult)\b/i],
];

export function familyOf(text: string): GenreFamily {
  return FAMILY_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'other';
}

const isNetwork = (s: string) => /^[\w-]+(\.[\w-]+)+$/.test(s.trim()) && !/\s/.test(s.trim());

export function stationLabel(s: Pick<Station, 'name' | 'tags' | 'genre'>): StationLabel {
  let rest = s.name.trim();
  const genres: string[] = [];
  let network: string | undefined;

  // bracketed bits anywhere: "(Euro EDM)", "(181.fm)", "[Pop/Rock]"
  rest = rest.replace(/[([]([^)\]]*)[)\]]/g, (_, inner: string) => {
    const t = inner.trim();
    if (!t) return ' ';
    if (isNetwork(t)) network ??= t;
    else genres.push(...t.split(/\s*[/,|]\s*/).filter(Boolean));
    return ' ';
  });
  // "Name@181.FM" or "Name @ 181.fm"
  rest = rest.replace(/\s*@\s*([\w-]+(?:\.[\w-]+)+)/, (_, n: string) => {
    network ??= n;
    return ' ';
  });
  rest = rest.replace(/\s{2,}/g, ' ').trim();

  // whatever trails the last bracket ("KADA Cool (Contemporary) Ada, OK") is a place, not the title
  let title = rest;
  let place: string | undefined;
  const firstBracket = s.name.search(/[([]/);
  if (firstBracket > 0) {
    const head = s.name.slice(0, firstBracket).replace(/\s*@\s*[\w-]+(?:\.[\w-]+)+/, '').trim();
    const tail = rest.slice(head.length).trim();
    if (head && tail && rest.startsWith(head)) {
      title = head;
      place = tail.replace(/^[-,·\s]+/, '') || undefined;
    }
  }
  title = title.replace(/[-–·,\s]+$/, '') || s.name.trim();

  // a genre someone set (Edit station) wins; else tags from the server ("agentic radio") count when the name had none
  const set = s.genre?.split(/\s*[,/|]\s*/).map((t) => t.trim()).filter(Boolean) ?? [];
  const tagWords = s.tags?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];
  const all = set.length ? set : genres.length ? genres : tagWords;
  // the first genre that says anything wins ("Pop/Rock/Hits" is pop), then the title ("BigRigFM")
  const family = [...(set.length ? set : [...genres, ...tagWords]), title].map(familyOf).find((f) => f !== 'other') ?? 'other';

  return { title, genres: all, network, place, family, mark: markOf(title) };
}

/** "90's Dance" → "90s", "108.9 The Office" → "108", "Energy 93" → "93", "Classic Hits" → "CH", "The Point" → "P". */
export function markOf(title: string): string {
  const clean = title.replace(/[^\p{L}\p{N}\s.']/gu, ' ').trim();
  const words = clean.split(/\s+/).filter((w) => w && !/^the$/i.test(w));
  // a number in the name is the most recognisable bit ("Hot 108", "Awesome 80s")
  const num = words.map((w) => w.match(/^(\d+)(?:'?s)?$/) ?? w.match(/^(\d+)/)).find(Boolean);
  if (num) return num[0].replace("'", '').slice(0, 3);
  const letters = words.slice(0, 2).map((w) => w[0]).join('');
  return letters.toUpperCase() || '♪';
}

/** Group stations by family, keeping each group in the order given and the groups in FAMILY_NAMES order. */
export function groupByFamily<T extends Pick<Station, 'name' | 'tags' | 'genre'>>(list: T[]): { family: GenreFamily; stations: T[] }[] {
  const groups = new Map<GenreFamily, T[]>();
  for (const s of list) {
    const f = stationLabel(s).family;
    groups.set(f, [...(groups.get(f) ?? []), s]);
  }
  return (Object.keys(FAMILY_NAMES) as GenreFamily[]).filter((f) => groups.has(f)).map((family) => ({ family, stations: groups.get(family)! }));
}
