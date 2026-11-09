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

describe('every act', () => {
  it('draws for every species, boy and girl, including the Reactor, Bongo and Pianist acts', async () => {
    // the player behind the rig makes an <audio> when it loads; tests run without a DOM
    vi.stubGlobal('Audio', function Audio() {
      return new Proxy({}, { get: () => () => {} });
    });
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ACTS, Critter, SPECIES } = await import('../components/critters/Critter');
    expect(ACTS.map((a) => a.id)).toEqual(expect.arrayContaining(['reactor', 'bongo', 'piano']));
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
