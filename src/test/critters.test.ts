import { describe, expect, it } from 'vitest';
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
