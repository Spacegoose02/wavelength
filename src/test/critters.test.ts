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
      expect(girl, sp.id).toContain('class="girl-bow"');
    }
  });
});
