import { describe, expect, it, vi } from 'vitest';
import { critterFromOldPick } from '../store/settings';

describe('critterFromOldPick', () => {
  it('turns the old single critter pick into a species and an act', () => {
    expect(critterFromOldPick('dj')).toEqual({ critter: 'raccoon', act: 'dj' });
    expect(critterFromOldPick('rocker')).toEqual({ critter: 'raccoon', act: 'rocker' });
    expect(critterFromOldPick('shark')).toEqual({ critter: 'shark', act: 'drums' });
    expect(critterFromOldPick('alien')).toEqual({ critter: 'alien', act: 'theremin' });
    expect(critterFromOldPick('grey')).toEqual({ critter: 'grey', act: 'synth' });
    expect(critterFromOldPick('bear-brown')).toEqual({ critter: 'bear-brown', act: 'accordion' });
  });
  it('falls back to the DJ raccoon for anything unknown', () => {
    expect(critterFromOldPick('dragon')).toEqual({ critter: 'raccoon', act: 'dj' });
    expect(critterFromOldPick(undefined)).toEqual({ critter: 'raccoon', act: 'dj' });
  });
});

describe('critter species and looks', () => {
  it('adds lashes and a bow only for the girl look, on every species', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const { GirlContext } = await import('../components/critters/faces');
    const draw = (girl: boolean, species: (typeof SPECIES)[number]) =>
      renderToStaticMarkup(h(GirlContext.Provider, { value: girl }, h('svg', null, h(Head, { species }))));
    for (const sp of SPECIES) {
      expect(sp.fit?.bow, sp.id).toBeDefined();
      const boy = draw(false, sp);
      const girl = draw(true, sp);
      expect(boy, sp.id).not.toMatch(/class="(lashes|girl-bow)[ "]/);
      expect(girl, sp.id).toMatch(/class="lashes[ "]/);
      expect(girl, sp.id).toMatch(/class="girl-bow[ "]/);
    }
  });
});

describe('the moose', () => {
  it('is a species with antlers drawn behind the head, under any hat', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const moose = SPECIES.find((s) => s.id === 'moose')!;
    expect(moose.noun).toBe('moose');
    const hat = h('g', { className: 'own-hat' });
    const svg = renderToStaticMarkup(h('svg', null, h(Head, { species: moose, hat })));
    // the antlers come before the hat, so the hat covers their roots
    expect(svg.indexOf('moose-antlers')).toBeGreaterThan(-1);
    expect(svg.indexOf('moose-antlers')).toBeLessThan(svg.indexOf('own-hat'));
  });
});

describe('the turtle', () => {
  it('is a species whose shell is drawn under the top, so the clothes go over it', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Body, Legs } = await import('../components/critters/parts');
    const turtle = SPECIES.find((s) => s.id === 'turtle')!;
    expect(turtle.noun).toBe('turtle');
    const svg = renderToStaticMarkup(h('svg', null, h(Legs, { species: turtle }), h(Body, { species: turtle, children: null })));
    expect(svg.indexOf('turtle-shell')).toBeGreaterThan(-1);
    expect(svg.indexOf('turtle-shell')).toBeLessThan(svg.indexOf('data-part="body"'));
  });
});

describe('the elephant, tiger and lion', () => {
  const draw = async (id: string, girl: boolean) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const { GirlContext } = await import('../components/critters/faces');
    const species = SPECIES.find((s) => s.id === id)!;
    const hat = h('g', { className: 'own-hat' });
    return renderToStaticMarkup(h(GirlContext.Provider, { value: girl }, h('svg', null, h(Head, { species, hat }))));
  };

  it('are species', async () => {
    const { SPECIES } = await import('../components/critters/species');
    expect(SPECIES.map((s) => s.id)).toEqual(expect.arrayContaining(['elephant', 'tiger', 'lion']));
  });

  it('draws the elephant ears and the lion mane behind the head, so a hat covers their roots', async () => {
    const elephant = await draw('elephant', false);
    expect(elephant.indexOf('elephant-ears')).toBeGreaterThan(-1);
    expect(elephant.indexOf('elephant-ears')).toBeLessThan(elephant.indexOf('head-elephant'));
    expect(elephant.indexOf('elephant-trunk')).toBeLessThan(elephant.indexOf('own-hat'));
    const lion = await draw('lion', false);
    expect(lion.indexOf('lion-mane')).toBeGreaterThan(-1);
    expect(lion.indexOf('lion-mane')).toBeLessThan(lion.indexOf('head-lion'));
  });

  it('draws the girl lion as a lioness, with no mane', async () => {
    expect(await draw('lion', true)).not.toContain('lion-mane');
  });
});

describe('the panda', () => {
  const draw = async (girl: boolean) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const { GirlContext } = await import('../components/critters/faces');
    const species = SPECIES.find((s) => s.id === 'panda')!;
    return renderToStaticMarkup(h(GirlContext.Provider, { value: girl }, h('svg', null, h(Head, { species, hat: h('g', { className: 'own-hat' }) }))));
  };

  it('is a species with its own figure', async () => {
    const { SPECIES } = await import('../components/critters/species');
    const { FIGURES } = await import('../components/critters/bodies');
    expect(SPECIES.find((s) => s.id === 'panda')?.figure).toBe(FIGURES.panda);
  });

  it('draws its ears behind the head, so the cowboy hat can hide them, and lashes only on the girl', async () => {
    const boy = await draw(false);
    expect(boy.indexOf('data-part="ear-l"')).toBeGreaterThan(-1);
    expect(boy.indexOf('data-part="ear-l"')).toBeLessThan(boy.indexOf('head-panda'));
    expect(boy).not.toContain('lashes');
    expect(await draw(true)).toContain('lashes');
  });
});

describe('the owl and the T. rex', () => {
  const draw = async (id: string, girl: boolean) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const { GirlContext } = await import('../components/critters/faces');
    const species = SPECIES.find((s) => s.id === id)!;
    return renderToStaticMarkup(h(GirlContext.Provider, { value: girl }, h('svg', null, h(Head, { species, hat: h('g', { className: 'own-hat' }) }))));
  };
  const arm = async (id: string) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Arm } = await import('../components/critters/parts');
    const { SpeciesContext } = await import('../components/critters/bodies');
    const species = SPECIES.find((s) => s.id === id)!;
    return renderToStaticMarkup(h(SpeciesContext.Provider, { value: species }, h('svg', null, h(Arm, { part: 'arm-r', d: 'M262 268 Q 290 300 300 330', hand: [300, 330] }))));
  };

  it('are species with their own figures', async () => {
    const { SPECIES } = await import('../components/critters/species');
    const { FIGURES } = await import('../components/critters/bodies');
    expect(SPECIES.find((s) => s.id === 'owl')?.figure).toBe(FIGURES.owl);
    expect(SPECIES.find((s) => s.id === 'trex')?.figure).toBe(FIGURES.trex);
  });

  it('draws the owl ear tufts behind the head, so the cowboy hat can hide them, and lashes only on the girl', async () => {
    const boy = await draw('owl', false);
    expect(boy.indexOf('data-part="ear-l"')).toBeGreaterThan(-1);
    expect(boy.indexOf('data-part="ear-l"')).toBeLessThan(boy.indexOf('head-owl'));
    expect(boy).not.toContain('lashes');
    expect(await draw('owl', true)).toContain('lashes');
  });

  it('gives the owl feathered wings for arms and the T. rex a thin forearm with claws', async () => {
    const owl = await arm('owl');
    expect(owl).toContain('wing-seam');
    const trex = await arm('trex');
    expect(trex).toContain('hand-claw');
    // the forearm, past the elbow, is thinner than the upper arm
    const widths = [...trex.matchAll(/class="sleeve"[^>]*stroke-width="(\d+)"/g)].map((m) => Number(m[1]));
    expect(widths[1]).toBeLessThan(widths[0]);
    expect(await arm('panda')).not.toMatch(/wing-seam|hand-claw/);
  });
});

describe('the monkey, the flamingo and the gorilla', () => {
  const draw = async (id: string, hidesEars = false) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const species = SPECIES.find((s) => s.id === id)!;
    return renderToStaticMarkup(h('svg', null, h(Head, { species, hat: h('g', { className: 'own-hat' }), hidesEars })));
  };
  const arm = async (id: string) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Arm } = await import('../components/critters/parts');
    const { SpeciesContext } = await import('../components/critters/bodies');
    const species = SPECIES.find((s) => s.id === id)!;
    return renderToStaticMarkup(h(SpeciesContext.Provider, { value: species }, h('svg', null, h(Arm, { part: 'arm-r', d: 'M262 268 Q 290 300 300 330', hand: [300, 330] }))));
  };

  it('are species with their own figures', async () => {
    const { SPECIES } = await import('../components/critters/species');
    const { FIGURES } = await import('../components/critters/bodies');
    for (const id of ['monkey', 'flamingo', 'gorilla'] as const) expect(SPECIES.find((s) => s.id === id)?.figure).toBe(FIGURES[id]);
  });

  it('draws the monkey and gorilla ears behind the head, and keeps the monkey ears out under the cowboy hat', async () => {
    for (const id of ['monkey', 'gorilla']) {
      const svg = await draw(id);
      expect(svg.indexOf('data-part="ear-l"'), id).toBeGreaterThan(-1);
      expect(svg.indexOf('data-part="ear-l"'), id).toBeLessThan(svg.indexOf(`head-${id}`));
    }
    // the ears go under-hat with the cowboy hat; styles.css shows the monkey's again (they sit at the sides)
    expect(await draw('monkey', true)).toContain('under-hat');
  });

  it('gives the flamingo wings for arms and a bill drawn over its singing mouth, so the mouth opens under it', async () => {
    expect(await arm('flamingo')).toContain('wing-seam');
    expect(await arm('gorilla')).not.toMatch(/wing-seam|hand-claw/);
    const svg = await draw('flamingo');
    expect(svg.indexOf('data-part="yawn"')).toBeGreaterThan(-1);
    expect(svg.indexOf('url(#fl-bill)')).toBeGreaterThan(svg.indexOf('data-part="yawn"'));
  });

  it('gives the gorilla the broadest shoulders and the longest reach, and the flamingo the longest neck', async () => {
    const { FIGURES } = await import('../components/critters/bodies');
    const span = (f: { shoulders: [[number, number], [number, number]] }) => f.shoulders[1][0] - f.shoulders[0][0];
    for (const f of Object.values(FIGURES)) {
      expect(span(FIGURES.gorilla)).toBeGreaterThanOrEqual(span(f));
      expect(FIGURES.gorilla.reach).toBeGreaterThanOrEqual(f.reach);
      expect(FIGURES.flamingo.head[0]).toBeLessThanOrEqual(f.head[0]);
    }
  });
});

describe('the penguin, fox, axolotl, sloth, octopus, dragon, frog, bunny and red panda', () => {
  const NINE = ['penguin', 'fox', 'axolotl', 'sloth', 'octopus', 'dragon', 'frog', 'bunny', 'red-panda'] as const;
  const draw = async (id: string) => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const species = SPECIES.find((s) => s.id === id)!;
    return renderToStaticMarkup(h('svg', null, h(Head, { species })));
  };

  it('are species with their own figures', async () => {
    const { SPECIES } = await import('../components/critters/species');
    const { FIGURES } = await import('../components/critters/bodies');
    const key = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) as keyof typeof FIGURES;
    for (const id of NINE) expect(SPECIES.find((s) => s.id === id)?.figure, id).toBe(FIGURES[key(id)]);
  });

  it('lets the sloth play half a beat late and the frog hop, and everyone else move as usual', async () => {
    const { FIGURES } = await import('../components/critters/bodies');
    expect(FIGURES.sloth.move).toBe('late');
    expect(FIGURES.frog.move).toBe('hop');
    const moving = Object.entries(FIGURES).filter(([, f]) => f.move).map(([k]) => k);
    expect(moving.sort()).toEqual(['frog', 'sloth']);
  });

  it('marks the svg with how the species moves, for the rig', async () => {
    vi.stubGlobal('Audio', function Audio() {
      return new Proxy({}, { get: () => () => {} });
    });
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { Critter } = await import('../components/critters/Critter');
    const svg = (species: string) => renderToStaticMarkup(h(Critter, { species, act: 'dj', still: true } as never));
    expect(svg('sloth')).toContain('data-move="late"');
    expect(svg('frog')).toContain('data-move="hop"');
    expect(svg('fox')).not.toContain('data-move');
  });

  it('gives the penguin flippers instead of hands, and the octopus two more arms', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { SPECIES } = await import('../components/critters/species');
    const { Arm, Legs } = await import('../components/critters/parts');
    const { SpeciesContext } = await import('../components/critters/bodies');
    const sp = (id: string) => SPECIES.find((s) => s.id === id)!;
    const arm = (id: string) =>
      renderToStaticMarkup(h(SpeciesContext.Provider, { value: sp(id) }, h('svg', null, h(Arm, { part: 'arm-r', d: 'M262 268 Q 290 300 300 330', hand: [300, 330] }))));
    expect(arm('penguin')).toContain('flipper-under');
    expect(arm('penguin')).not.toMatch(/<circle class="hand/);
    expect(arm('fox')).not.toContain('flipper-under');
    const legs = renderToStaticMarkup(h(SpeciesContext.Provider, { value: sp('octopus') }, h('svg', null, h(Legs, { species: sp('octopus') }))));
    expect(legs).toContain('data-part="tentacle-l"');
    expect(legs).toContain('data-part="tentacle-r"');
  });

  it('makes the girl dragon white and the boy charcoal', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { GirlContext } = await import('../components/critters/faces');
    const boy = await draw('dragon');
    const { SPECIES } = await import('../components/critters/species');
    const { Head } = await import('../components/critters/parts');
    const girl = renderToStaticMarkup(h(GirlContext.Provider, { value: true }, h('svg', null, h(Head, { species: SPECIES.find((s) => s.id === 'dragon')! }))));
    expect(boy).toContain('url(#dr-skin)');
    expect(girl).toContain('url(#drw-skin)');
    expect(girl).not.toContain('url(#dr-skin)');
  });

  it('gives the dragon a hidden puff of smoke for a flourish, and the axolotl gills that glow', async () => {
    expect(await draw('dragon')).toMatch(/data-part="smoke" opacity="0"/);
    expect(await draw('axolotl')).toContain('axolotl-gills');
  });
});

describe('every act', () => {
  it('draws for every species, boy and girl, including the Acoustic, Surf rock and Singer acts', async () => {
    // the player behind the rig makes an <audio> when it loads; tests run without a DOM
    vi.stubGlobal('Audio', function Audio() {
      return new Proxy({}, { get: () => () => {} });
    });
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ACTS, Critter, SPECIES } = await import('../components/critters/Critter');
    expect(ACTS.map((a) => a.id)).toEqual(expect.arrayContaining(['reactor', 'bongo', 'piano', 'marimba', 'violin', 'acoustic', 'surf', 'singer']));
    expect(ACTS.map((a) => a.id)).not.toEqual(expect.arrayContaining(['sax']));
    expect(SPECIES.map((s) => s.id)).toContain('turkey');
    for (const act of ACTS) {
      for (const sp of SPECIES) {
        for (const girl of [false, true]) {
          const svg = renderToStaticMarkup(h(Critter, { species: sp.id, act: act.id, girl, still: true }));
          expect(svg, `${act.id} ${sp.id}`).toContain('class="np-scene-canvas critter');
          // both arms and the head are always there, so the rig can move them
          for (const part of ['head', 'body', 'arm-l', 'arm-r']) expect(svg, `${act.id} ${sp.id} ${part}`).toContain(`data-part="${part}"`);
        }
      }
    }
  });
});

describe('retired acts', () => {
  it('turns a saved Saxophone, Harpist or Tuba pick into the act that replaced it', async () => {
    vi.stubGlobal('Audio', function Audio() {
      return new Proxy({}, { get: () => () => {} });
    });
    const { findAct } = await import('../components/critters/Critter');
    expect(findAct('sax' as never).id).toBe('surf');
    expect(findAct('harp' as never).id).toBe('acoustic');
    expect(findAct('tuba' as never).id).toBe('singer');
    expect(findAct('rocker').id).toBe('rocker');
  });
});
